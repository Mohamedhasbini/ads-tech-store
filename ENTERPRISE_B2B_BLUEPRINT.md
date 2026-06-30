# ADS Tech Enterprise B2B Portal Blueprint

This blueprint upgrades the current GitHub Pages storefront plus Railway Node backend into a B2B customer portal for corporate procurement, maintenance contracts, RMA tracking, invoicing, and admin CRM operations.

## Phase 1 - Database Schemas

Use PostgreSQL on Railway. Store prices as integer cents and keep VAT/tax rates as basis points.

```sql
create type user_role as enum ('corporate_buyer','corporate_manager','technician','admin','finance');
create type quote_status as enum ('draft','pending','priced','approved','rejected','converted','expired');
create type rma_status as enum ('received','diagnostics','awaiting_parts','repaired','shipped');
create type contract_status as enum ('template','ready_for_signature','active','expired','cancelled');

create table companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  vat_number text,
  billing_email text not null,
  billing_address jsonb not null default '{}',
  verified boolean not null default false,
  tier text not null default 'standard',
  lifetime_spend_cents bigint not null default 0,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  name text not null,
  email citext unique not null,
  password_hash text,
  sso_subject text,
  roles user_role[] not null default '{corporate_buyer}',
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  brand text not null,
  name text not null,
  category text not null,
  specs text,
  image_url text,
  base_price_cents integer,
  active boolean not null default true,
  metadata jsonb not null default '{}'
);

create table company_price_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  min_qty integer not null default 1,
  discount_bps integer not null default 0,
  fixed_unit_price_cents integer,
  starts_at timestamptz,
  ends_at timestamptz
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade not null,
  requested_by uuid references users(id) not null,
  approved_by uuid references users(id),
  reference text unique not null,
  title text not null,
  status quote_status not null default 'pending',
  required_by date,
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  vat_bps integer not null default 1100,
  vat_cents bigint not null default 0,
  total_cents bigint not null default 0,
  notes text,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete cascade not null,
  product_id uuid references products(id),
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer,
  discount_bps integer not null default 0,
  line_total_cents bigint not null default 0
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) not null,
  quote_id uuid references quotes(id),
  reference text unique not null,
  status text not null default 'pending_fulfillment',
  subtotal_cents bigint not null,
  vat_cents bigint not null,
  total_cents bigint not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade not null,
  product_id uuid references products(id),
  description text not null,
  quantity integer not null,
  unit_price_cents integer not null,
  line_total_cents bigint not null
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  company_id uuid references companies(id) not null,
  invoice_number text unique not null,
  pdf_url text,
  subtotal_cents bigint not null,
  vat_cents bigint not null,
  total_cents bigint not null,
  issued_at timestamptz not null default now()
);

create table contract_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier text not null,
  body_markdown text not null,
  current_version integer not null default 1,
  active boolean not null default true
);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) not null,
  template_id uuid references contract_templates(id) not null,
  template_version integer not null,
  status contract_status not null default 'ready_for_signature',
  coverage_summary text,
  starts_at date,
  ends_at date,
  signed_by uuid references users(id),
  signed_at timestamptz,
  signature_hash text,
  pdf_url text
);

create table fleet_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade not null,
  contract_id uuid references contracts(id),
  asset_tag text,
  serial_number text,
  product_id uuid references products(id),
  model text,
  site text,
  warranty_expires_at date,
  metadata jsonb not null default '{}'
);

create table rmas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) not null,
  asset_id uuid references fleet_assets(id),
  opened_by uuid references users(id) not null,
  assigned_technician_id uuid references users(id),
  rma_number text unique not null,
  status rma_status not null default 'received',
  serial_number text,
  asset_tag text,
  description text not null,
  shipping_label_url text,
  estimated_completion_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table rma_events (
  id uuid primary key default gen_random_uuid(),
  rma_id uuid references rmas(id) on delete cascade not null,
  status rma_status not null,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table cart_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade not null,
  name text not null,
  created_by uuid references users(id),
  items jsonb not null,
  created_at timestamptz not null default now()
);

create table jarvis_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  company_id uuid references companies(id),
  user_id uuid references users(id),
  intent text not null,
  payload jsonb not null default '{}',
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);
```

## Phase 2 - Railway Node.js / Express API Routes

Security baseline: JWT auth, role middleware, company-scoped queries, server-side price calculation, PDF generation on the server, and signed URLs for private files.

```js
import express from "express";
import PDFDocument from "pdfkit";
import { db } from "./db.js";
import { requireAuth, requireRole } from "./middleware/auth.js";

export const b2b = express.Router();
b2b.use(requireAuth);

b2b.get("/me", async (req, res) => {
  const company = await db.one("select * from companies where id=$1", [req.user.company_id]);
  res.json({ user: { ...req.user, company_name: company.legal_name, lifetime_spend: company.lifetime_spend_cents / 100 } });
});

b2b.post("/quotes", requireRole("corporate_buyer","corporate_manager"), async (req, res) => {
  const { title, items, notes, required_by } = req.body;
  const quote = await db.tx(async t => {
    const q = await t.one(
      `insert into quotes(company_id, requested_by, reference, title, notes, required_by)
       values($1,$2,$3,$4,$5,$6) returning *`,
      [req.user.company_id, req.user.id, `Q-${Date.now()}`, title, notes, required_by || null]
    );
    for (const item of items) {
      await t.none(
        `insert into quote_items(quote_id, product_id, description, quantity)
         values($1,$2,$3,$4)`,
        [q.id, item.product_id || null, item.description, item.quantity || 1]
      );
    }
    return q;
  });
  res.status(201).json({ quote });
});

b2b.get("/quotes", async (req, res) => {
  const quotes = await db.any("select * from quotes where company_id=$1 order by created_at desc", [req.user.company_id]);
  res.json({ quotes });
});

b2b.post("/quotes/:id/approve", requireRole("corporate_manager"), async (req, res) => {
  const quote = await db.one(
    `update quotes set status='approved', approved_by=$2, updated_at=now()
     where id=$1 and company_id=$3 and status='priced' returning *`,
    [req.params.id, req.user.id, req.user.company_id]
  );
  res.json({ quote });
});

b2b.post("/quotes/:id/reject", requireRole("corporate_manager"), async (req, res) => {
  const quote = await db.one(
    `update quotes set status='rejected', approved_by=$2, updated_at=now()
     where id=$1 and company_id=$3 returning *`,
    [req.params.id, req.user.id, req.user.company_id]
  );
  res.json({ quote });
});

b2b.post("/quotes/:id/convert-to-po", requireRole("corporate_buyer","corporate_manager"), async (req, res) => {
  const result = await db.tx(async t => {
    const q = await t.one("select * from quotes where id=$1 and company_id=$2 and status='approved'", [req.params.id, req.user.company_id]);
    const order = await t.one(
      `insert into orders(company_id, quote_id, reference, subtotal_cents, vat_cents, total_cents, created_by)
       values($1,$2,$3,$4,$5,$6,$7) returning *`,
      [q.company_id, q.id, `PO-${Date.now()}`, q.subtotal_cents, q.vat_cents, q.total_cents, req.user.id]
    );
    await t.none("update quotes set status='converted' where id=$1", [q.id]);
    await t.none("update companies set lifetime_spend_cents=lifetime_spend_cents+$1 where id=$2", [q.total_cents, q.company_id]);
    return order;
  });
  res.status(201).json({ order: result });
});

b2b.post("/rmas", requireRole("corporate_buyer","corporate_manager"), async (req, res) => {
  const rma = await db.one(
    `insert into rmas(company_id, opened_by, rma_number, serial_number, asset_tag, description)
     values($1,$2,$3,$4,$5,$6) returning *`,
    [req.user.company_id, req.user.id, `RMA-${Date.now()}`, req.body.serial_number, req.body.asset_tag, req.body.description]
  );
  await db.none("insert into rma_events(rma_id,status,note,created_by) values($1,'received','RMA opened',$2)", [rma.id, req.user.id]);
  res.status(201).json({ rma });
});

b2b.get("/rmas", async (req, res) => {
  const rmas = await db.any("select * from rmas where company_id=$1 order by created_at desc", [req.user.company_id]);
  res.json({ rmas });
});

b2b.patch("/admin/rmas/:id/status", requireRole("technician","admin"), async (req, res) => {
  const rma = await db.one("update rmas set status=$2, updated_at=now() where id=$1 returning *", [req.params.id, req.body.status]);
  await db.none("insert into rma_events(rma_id,status,note,created_by) values($1,$2,$3,$4)", [rma.id, req.body.status, req.body.note || null, req.user.id]);
  res.json({ rma });
});

b2b.get("/contracts", async (req, res) => {
  const contracts = await db.any(
    `select c.*, ct.name as template_name from contracts c join contract_templates ct on ct.id=c.template_id
     where c.company_id=$1 order by c.created_at desc nulls last`,
    [req.user.company_id]
  );
  res.json({ contracts });
});

b2b.post("/contracts/:id/sign", requireRole("corporate_manager"), async (req, res) => {
  const signatureHash = crypto.createHash("sha256").update(`${req.user.id}:${req.params.id}:${Date.now()}`).digest("hex");
  const contract = await db.one(
    `update contracts set status='active', signed_by=$2, signed_at=now(), signature_hash=$3
     where id=$1 and company_id=$4 and status='ready_for_signature' returning *`,
    [req.params.id, req.user.id, signatureHash, req.user.company_id]
  );
  res.json({ contract });
});

b2b.get("/orders", async (req, res) => {
  const orders = await db.any("select * from orders where company_id=$1 order by created_at desc", [req.user.company_id]);
  res.json({ orders });
});

b2b.get("/orders/:id/invoice", async (req, res) => {
  const order = await db.one("select * from orders where id=$1 and company_id=$2", [req.params.id, req.user.company_id]);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${order.reference}.pdf"`);
  const pdf = new PDFDocument();
  pdf.pipe(res);
  pdf.fontSize(18).text("ADS Tech Invoice");
  pdf.moveDown().text(`Order: ${order.reference}`);
  pdf.text(`Subtotal: $${(order.subtotal_cents / 100).toFixed(2)}`);
  pdf.text(`VAT: $${(order.vat_cents / 100).toFixed(2)}`);
  pdf.text(`Total: $${(order.total_cents / 100).toFixed(2)}`);
  pdf.end();
});

b2b.post("/jarvis/events", async (req, res) => {
  await db.none(
    `insert into jarvis_events(session_id,company_id,user_id,intent,payload,escalated)
     values($1,$2,$3,$4,$5,$6)`,
    [req.body.session_id, req.user.company_id, req.user.id, req.body.intent, req.body.payload || {}, !!req.body.escalated]
  );
  res.status(204).end();
});
```

Admin command center route groups:

```txt
GET    /api/admin/companies
GET    /api/admin/companies/:id/fleet
PATCH  /api/admin/users/:id/roles
GET    /api/admin/quotes?status=pending
PATCH  /api/admin/quotes/:id/price
POST   /api/admin/quotes/:id/send
GET    /api/admin/rmas
PATCH  /api/admin/rmas/:id/status
GET    /api/admin/contracts
POST   /api/admin/contracts/from-template
GET    /api/admin/jarvis-events
```

## Phase 3 - GitHub Pages Frontend Integration

Files added:

- `portal.html`: authenticated B2B dashboard shell.
- `portal.js`: Vanilla JS API client, role-based UI permissions, quote workflow, SLA signing, RMA pipeline, order invoice downloads, and saved reorder templates.

Static security rules:

- Never store secrets in GitHub Pages.
- Store only short-lived JWTs in localStorage, or ideally use Railway-managed refresh cookies with `SameSite=None; Secure`.
- Every protected action is rechecked by backend role middleware.
- The portal should be linked from the storefront nav as `portal.html`.

Tiered B2B pricing JSON shape returned by `/api/products` for authenticated users:

```json
{
  "slug": "thinkpad-e16-ultra-7",
  "brand": "Lenovo",
  "name": "ThinkPad E16",
  "base_price_cents": 106900,
  "business_pricing": [
    { "min_qty": 5, "discount_bps": 700, "label": "Buy 5+ for 7% off" },
    { "min_qty": 10, "discount_bps": 1500, "label": "Buy 10+ for 15% off" },
    { "min_qty": 25, "discount_bps": 2200, "label": "Fleet pricing" }
  ]
}
```

Frontend display logic:

```js
function bestTier(product, qty) {
  return (product.business_pricing || [])
    .filter(t => qty >= t.min_qty)
    .sort((a, b) => b.min_qty - a.min_qty)[0] || null;
}
function unitPrice(product, qty) {
  const tier = bestTier(product, qty);
  const discount = tier ? tier.discount_bps : 0;
  return Math.round(product.base_price_cents * (10000 - discount) / 10000);
}
```

Repair pipeline display states:

```txt
Received -> In Diagnostics -> Awaiting Parts -> Repaired -> Shipped
```

Map to API enum values:

```js
const RMA_STEPS = ["received", "diagnostics", "awaiting_parts", "repaired", "shipped"];
```
