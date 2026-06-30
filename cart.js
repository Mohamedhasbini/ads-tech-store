/* ADS Tech cart — talks to the secure store backend.
 * Degrades gracefully: if the API is unreachable, the site keeps working
 * exactly as before (WhatsApp ordering), just without live cart/pricing.
 *
 * Configure the backend URL by setting window.ADS_API before this script,
 * e.g.  <script>window.ADS_API='https://store.ads-tech.com'</script>
 */
(function () {
  "use strict";
  var API = (window.ADS_API || "https://ads-tech-store-production.up.railway.app").replace(/\/$/, "");
  var KEY = "ads_cart_v1";
  var BYSLUG = {};        // slug -> product (live)
  var cart = load();      // {slug: qty}
  var promo = { code: "", discount: 0 };

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { localStorage.setItem(KEY, JSON.stringify(cart)); }
  function slugify(b, n) {
    return (b + " " + n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  function money(cents) {
    return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function api(path, opts) {
    return fetch(API + path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
  }
  function itemsPayload() {
    return Object.keys(cart).map(function (s) { return { slug: s, qty: cart[s] }; });
  }
  function count() { return Object.keys(cart).reduce(function (a, s) { return a + cart[s]; }, 0); }

  /* ---- product hydration ---- */
  function boot() {
    api("/api/products").then(function (res) {
      if (!res.ok) throw new Error("bad");
      (res.j.products || []).forEach(function (p) { BYSLUG[p.slug] = p; });
      decorateCards();
      injectServices(res.j.products || []);
      mountUI();
    }).catch(function () {
      /* offline / API down: leave the static WhatsApp site untouched */
      console.warn("[ADS] store API unavailable — cart disabled, WhatsApp ordering still works.");
    });
  }

  /* Override each card's price with the live one and add an Add-to-cart button. */
  function decorateCards() {
    document.querySelectorAll(".pc").forEach(function (card) {
      var brand = (card.querySelector(".pc-brand") || {}).textContent || "";
      var name = (card.querySelector(".pc-name") || {}).textContent || "";
      var slug = card.dataset.slug || slugify(brand.trim(), name.trim());
      card.dataset.slug = slug;
      var p = BYSLUG[slug];
      if (!p) return;
      var priceEl = card.querySelector(".pc-price");
      if (priceEl) priceEl.innerHTML = '<span class="cur">$</span>' + (p.price_cents / 100).toLocaleString("en-US");
      lowStockBadge(card, p);
      var wa = card.querySelector(".pc-wa");
      if (wa && !card.querySelector(".pc-actions")) {
        var wrap = document.createElement("div");
        wrap.className = "pc-actions";
        var btn = document.createElement("button");
        btn.type = "button"; btn.className = "pc-add";
        btn.innerHTML = '<span>＋</span> Add to cart';
        if (!p.in_stock) { btn.disabled = true; btn.textContent = "Out of stock"; }
        btn.addEventListener("click", function (e) { e.preventDefault(); add(slug); });
        wa.parentNode.insertBefore(wrap, wa);
        wrap.appendChild(btn);
        wrap.appendChild(wa);
      }
    });
  }

  /* Render purchasable services (kind=service) as cards + a Services tab. */
  function injectServices(prods) {
    var grid = document.getElementById("pgrid");
    var tabs = document.querySelector(".tabs");
    if (!grid) return;
    var svcs = prods.filter(function (p) { return p.kind === "service"; });
    if (!svcs.length) return;
    if (tabs && !tabs.querySelector('[data-svc-tab]')) {
      var t = document.createElement("span");
      t.className = "tab"; t.setAttribute("data-svc-tab", "1");
      t.textContent = "Services";
      t.setAttribute("onclick", "filt('service',this)");
      tabs.appendChild(t);
    }
    svcs.forEach(function (p) {
      if (grid.querySelector('[data-slug="' + p.slug + '"]')) return;
      var card = document.createElement("div");
      card.className = "pc"; card.dataset.c = "service"; card.dataset.slug = p.slug;
      card.innerHTML =
        '<div class="pc-img" style="background:linear-gradient(135deg,#0b0c0f,#2b6fff);color:#fff;font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase">Service</div>' +
        '<div class="pc-info"><div class="pc-brand">' + esc(p.brand) + '</div>' +
        '<div class="pc-name">' + esc(p.name) + '</div>' +
        '<div class="pc-specs">' + esc(p.specs) + '</div></div>' +
        '<div class="pc-price"><span class="cur">$</span>' + (p.price_cents / 100).toLocaleString("en-US") + '</div>';
      var wrap = document.createElement("div");
      wrap.className = "pc-actions";
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "pc-add"; btn.innerHTML = '<span>＋</span> Add to cart';
      btn.addEventListener("click", function () { add(p.slug); });
      wrap.appendChild(btn); card.appendChild(wrap);
      grid.appendChild(card);
    });
    var cnt = document.getElementById("cnt");
    if (cnt) cnt.textContent = grid.querySelectorAll(".pc").length + " products & services · cash on delivery or card · live pricing";
  }

  function esc(s) { return (s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* "Only N left" badge — shown only when the admin enabled it for this product
   * (backend returns low_stock_left only when show_low_stock is on and qty is low). */
  function lowStockBadge(card, p) {
    var img = card.querySelector(".pc-img");
    if (!img || card.querySelector(".pc-low")) return;
    if (typeof p.low_stock_left === "number" && p.low_stock_left > 0) {
      var b = document.createElement("div");
      b.className = "pc-low";
      b.textContent = "Only " + p.low_stock_left + " left";
      img.appendChild(b);
    }
  }

  /* ---- cart mutations ---- */
  function add(slug) { cart[slug] = (cart[slug] || 0) + 1; if (cart[slug] > 99) cart[slug] = 99; save(); render(); openDrawer(); toast(slug); }
  function setQty(slug, q) { q = Math.max(0, Math.min(99, q)); if (!q) delete cart[slug]; else cart[slug] = q; save(); render(); }
  function toast(slug) {
    var fab = document.getElementById("cart-fab"); if (!fab) return;
    fab.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 300 });
  }

  /* ---- UI ---- */
  function mountUI() {
    if (document.getElementById("cart-fab")) return render();
    var fab = document.createElement("button");
    fab.id = "cart-fab"; fab.setAttribute("aria-label", "Open cart");
    fab.innerHTML = '🛒 Cart <span class="cart-count">0</span>';
    fab.addEventListener("click", openDrawer);
    document.body.appendChild(fab);

    var ov = document.createElement("div");
    ov.id = "cart-ov";
    ov.innerHTML =
      '<aside id="cart-drawer" role="dialog" aria-label="Shopping cart">' +
      '<div class="cart-top"><b>Your cart</b><button class="cart-x" aria-label="Close">&times;</button></div>' +
      '<div class="cart-body" id="cart-body"></div>' +
      '<div class="cart-foot" id="cart-foot"></div></aside>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) closeDrawer(); });
    ov.querySelector(".cart-x").addEventListener("click", closeDrawer);
    render();
  }
  function openDrawer() { var o = document.getElementById("cart-ov"); if (o) o.classList.add("open"); }
  function closeDrawer() { var o = document.getElementById("cart-ov"); if (o) o.classList.remove("open"); }

  function render() {
    var c = document.querySelector("#cart-fab .cart-count"); if (c) c.textContent = count();
    var body = document.getElementById("cart-body"), foot = document.getElementById("cart-foot");
    if (!body || !foot) return;
    var slugs = Object.keys(cart);
    if (!slugs.length) {
      body.innerHTML = '<div class="cart-empty">Your cart is empty.<br>Browse products & services to add items.</div>';
      foot.innerHTML = ""; return;
    }
    var subtotal = 0, html = "";
    slugs.forEach(function (s) {
      var p = BYSLUG[s]; if (!p) return;
      var line = p.price_cents * cart[s]; subtotal += line;
      html +=
        '<div class="ci">' +
        (p.img ? '<img class="ci-img" src="' + esc(p.img) + '" alt="">' : '<div class="ci-img"></div>') +
        '<div class="ci-main"><div class="ci-brand">' + esc(p.brand) + '</div>' +
        '<div class="ci-name">' + esc(p.name) + '</div>' +
        '<div class="ci-row"><button class="qbtn" data-dec="' + s + '">−</button>' +
        '<span class="ci-q">' + cart[s] + '</span>' +
        '<button class="qbtn" data-inc="' + s + '">＋</button>' +
        '<button class="ci-rm" data-rm="' + s + '">Remove</button></div></div>' +
        '<div class="ci-price">' + money(line) + '</div></div>';
    });
    body.innerHTML = html;
    body.querySelectorAll("[data-inc]").forEach(function (b) { b.onclick = function () { setQty(b.dataset.inc, cart[b.dataset.inc] + 1); }; });
    body.querySelectorAll("[data-dec]").forEach(function (b) { b.onclick = function () { setQty(b.dataset.dec, cart[b.dataset.dec] - 1); }; });
    body.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { setQty(b.dataset.rm, 0); }; });

    var total = subtotal - promo.discount;
    foot.innerHTML =
      '<div class="cart-promo"><input id="promo-in" placeholder="Promo code" value="' + esc(promo.code) + '">' +
      '<button id="promo-apply">Apply</button></div>' +
      '<div class="promo-msg" id="promo-msg"></div>' +
      '<div class="cart-line"><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
      (promo.discount ? '<div class="cart-line"><span>Discount (' + esc(promo.code) + ')</span><span>−' + money(promo.discount) + '</span></div>' : '') +
      '<div class="cart-line tot"><span>Total</span><span>' + money(total) + '</span></div>' +
      '<div class="cart-fields">' +
      '<input id="co-name" placeholder="Full name" autocomplete="name">' +
      '<input id="co-phone" placeholder="Phone / WhatsApp" autocomplete="tel">' +
      '<input id="co-email" type="email" placeholder="Email (optional)" autocomplete="email">' +
      '<input id="co-address" placeholder="Delivery address" autocomplete="street-address">' +
      '<textarea id="co-notes" placeholder="Other — anything else we should know? (special requests, preferred time…)"></textarea>' +
      '<div class="pay-row">' +
      '<label><input type="radio" name="pay" value="cod" checked> Cash on delivery</label>' +
      '<label><input type="radio" name="pay" value="bank"> Bank / Whish</label></div>' +
      '</div>' +
      '<button class="cart-checkout" id="co-go">Place order · ' + money(total) + '</button>' +
      '<div class="cart-note" id="co-status">Prices in USD · genuine products · 1-yr warranty · delivery across Lebanon</div>';

    document.getElementById("promo-apply").onclick = applyPromo;
    document.getElementById("co-go").onclick = checkout;
  }

  function applyPromo() {
    var code = (document.getElementById("promo-in").value || "").trim();
    var msg = document.getElementById("promo-msg");
    if (!code) { promo = { code: "", discount: 0 }; render(); return; }
    api("/api/promo/validate", { method: "POST", body: JSON.stringify({ items: itemsPayload(), code: code }) })
      .then(function (res) {
        if (res.j && res.j.valid) {
          promo = { code: code.toUpperCase(), discount: res.j.discount_cents };
          render(); var m = document.getElementById("promo-msg"); if (m) { m.textContent = "✓ Code applied"; m.className = "promo-msg ok"; }
        } else {
          promo = { code: "", discount: 0 };
          var reason = { invalid_code: "Code not found", expired: "Code expired", usage_exceeded: "Code fully redeemed", min_order_not_met: "Order below minimum for this code" }[res.j && res.j.reason] || "Invalid code";
          render(); var m2 = document.getElementById("promo-msg"); if (m2) { m2.textContent = "✕ " + reason; m2.className = "promo-msg err"; }
        }
      }).catch(function () { var m = document.getElementById("promo-msg"); if (m) { m.textContent = "Could not check code"; m.className = "promo-msg err"; } });
  }

  function checkout() {
    var btn = document.getElementById("co-go"), status = document.getElementById("co-status");
    var name = val("co-name"), phone = val("co-phone");
    if (!name || !phone) { status.textContent = "Please add your name and phone."; status.style.color = "#c0392b"; return; }
    var method = (document.querySelector('input[name="pay"]:checked') || {}).value || "cod";
    btn.disabled = true; btn.textContent = "Placing order…";
    api("/api/checkout", { method: "POST", body: JSON.stringify({
      items: itemsPayload(), code: promo.code, name: name, phone: phone,
      email: val("co-email"), address: val("co-address"), notes: val("co-notes"),
      payment_method: method
    }) }).then(function (res) {
      if (!res.ok) throw new Error(res.j && res.j.error || "failed");
      var o = res.j;
      cart = {}; promo = { code: "", discount: 0 }; save();
      if (method === "card" && o.redirect_url) { window.location.href = o.redirect_url; return; }
      render();
      var tail = method === "card" ? " You'll be guided to payment."
        : method === "bank" || method === "whish" ? " We'll send bank transfer / Whish payment details on WhatsApp."
        : " Pay cash on delivery. We'll contact you on WhatsApp.";
      var paidMsg = "Order " + o.ref + " confirmed! Total " + money(o.total_cents) + "." + tail;
      document.getElementById("cart-body").innerHTML = '<div class="cart-empty">✓ ' + paidMsg + '</div>';
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = "Place order";
      status.textContent = "Could not place order (" + (e.message || "error") + "). Try WhatsApp ordering.";
      status.style.color = "#c0392b";
    });
  }
  function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
