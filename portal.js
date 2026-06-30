(function () {
  "use strict";
  var API = (window.ADS_API || "https://ads-tech-store-production.up.railway.app").replace(/\/$/, "");
  var TOKEN_KEY = "ads_b2b_token";
  var state = { me: null, quotes: [], rmas: [], contracts: [], orders: [] };
  var RMA_STEPS = ["received", "diagnostics", "awaiting_parts", "repaired", "shipped"];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : "" + s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function has(role) { return state.me && Array.isArray(state.me.roles) && state.me.roles.indexOf(role) >= 0; }
  function can(permission) {
    if (!state.me) return false;
    var roles = state.me.roles || [];
    var map = {
      "quote:create": ["corporate_buyer", "corporate_manager"],
      "quote:approve": ["corporate_manager"],
      "contract:sign": ["corporate_manager"],
      "order:create": ["corporate_buyer", "corporate_manager"],
      "rma:create": ["corporate_buyer", "corporate_manager", "technician"]
    };
    return (map[permission] || []).some(function (r) { return roles.indexOf(r) >= 0; });
  }
  function api(path, opts) {
    return fetch(API + path, Object.assign({
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() }
    }, opts || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || r.statusText);
        return j;
      });
    });
  }

  function setSession() {
    $("login-panel").hidden = !!state.me;
    $("portal-app").hidden = !state.me;
    $("session-box").innerHTML = state.me
      ? '<div class="status">' + esc(state.me.company_name) + '</div><div>' + esc(state.me.name) + '</div><div class="muted">' + esc((state.me.roles || []).join(", ")) + '</div><button class="btn" id="logout">Log out</button>'
      : '<span class="muted">Not signed in</span>';
    var out = $("logout");
    if (out) out.onclick = function () { localStorage.removeItem(TOKEN_KEY); location.reload(); };
    document.querySelectorAll("[data-permission]").forEach(function (el) {
      var ok = can(el.dataset.permission);
      if (el.tagName === "BUTTON") el.disabled = !ok;
      el.hidden = !ok && el.dataset.hideWhenDenied === "1";
    });
  }

  function renderDashboard() {
    $("account-summary").innerHTML = state.me
      ? "Roles: " + esc((state.me.roles || []).join(", ")) + "<br>Users: " + esc(state.me.company_user_count || 1) + "<br>Lifetime spend: $" + esc(state.me.lifetime_spend || 0)
      : "";
    $("quote-summary").textContent = state.quotes.filter(function (q) { return q.status !== "converted"; }).length + " open quotes";
    $("rma-summary").textContent = state.rmas.filter(function (r) { return r.status !== "shipped"; }).length + " active repair tickets";
  }
  function renderQuotes() {
    $("quotes-list").innerHTML = state.quotes.map(function (q) {
      var actions = "";
      if (q.status === "priced" && can("quote:approve")) actions += '<button class="btn ok" data-approve="' + q.id + '">Approve</button> ';
      if (q.status === "approved" && can("order:create")) actions += '<button class="btn primary" data-po="' + q.id + '">Convert to PO</button> ';
      if (q.status !== "converted" && can("quote:approve")) actions += '<button class="btn warn" data-reject="' + q.id + '">Reject</button>';
      return '<article class="row"><div><div><strong>' + esc(q.title) + '</strong></div><div class="muted">' + esc(q.reference) + ' · ' + esc(q.total_cents ? "$" + (q.total_cents / 100).toLocaleString() : "Awaiting pricing") + '</div><div class="status">' + esc(q.status) + '</div></div><div>' + actions + '</div></article>';
    }).join("") || '<div class="card muted">No quotes yet.</div>';
  }
  function renderContracts() {
    $("contracts-list").innerHTML = state.contracts.map(function (c) {
      var sign = c.status === "ready_for_signature" && can("contract:sign") ? '<button class="btn ok" data-sign="' + c.id + '">Digitally sign</button>' : "";
      return '<article class="row"><div><strong>' + esc(c.template_name) + '</strong><div class="muted">' + esc(c.coverage_summary || "") + '</div><div class="status">' + esc(c.status) + '</div></div><div><a class="btn" href="' + esc(API + "/api/b2b/contracts/" + c.id + "/download") + '" target="_blank" rel="noopener">Download PDF</a> ' + sign + '</div></article>';
    }).join("") || '<div class="card muted">No SLA contracts assigned.</div>';
  }
  function renderRmas() {
    $("rma-list").innerHTML = state.rmas.map(function (r) {
      var idx = Math.max(0, RMA_STEPS.indexOf(r.status));
      var steps = RMA_STEPS.map(function (_, i) { return '<div class="step ' + (i <= idx ? "on" : "") + '"></div>'; }).join("");
      return '<article class="card"><div class="row" style="border:0;padding:0"><div><strong>RMA ' + esc(r.rma_number) + '</strong><div class="muted">' + esc(r.asset_tag || r.serial_number || "Device") + '</div><div class="status">' + esc(r.status.replace(/_/g, " ")) + '</div></div><div><a class="btn" href="' + esc(API + "/api/b2b/rmas/" + r.id + "/shipping-label") + '" target="_blank" rel="noopener">Print label</a></div></div><div class="steps" aria-label="Repair status pipeline">' + steps + '</div></article>';
    }).join("") || '<div class="card muted">No repair tickets yet.</div>';
  }
  function renderOrders() {
    $("orders-list").innerHTML = state.orders.map(function (o) {
      var reorder = o.template_id ? '<button class="btn primary" data-reorder="' + o.template_id + '">Re-order template</button>' : "";
      return '<article class="row"><div><strong>' + esc(o.reference) + '</strong><div class="muted">' + esc(o.created_at || "") + ' · $' + esc(((o.total_cents || 0) / 100).toLocaleString()) + '</div><div class="status">' + esc(o.status) + '</div></div><div><a class="btn" href="' + esc(API + "/api/b2b/orders/" + o.id + "/invoice") + '" target="_blank" rel="noopener">Invoice PDF</a> ' + reorder + '</div></article>';
    }).join("") || '<div class="card muted">No orders yet.</div>';
  }
  function renderAll() {
    setSession(); renderDashboard(); renderQuotes(); renderContracts(); renderRmas(); renderOrders();
  }
  function load() {
    return Promise.all([
      api("/api/b2b/me"),
      api("/api/b2b/quotes"),
      api("/api/b2b/rmas"),
      api("/api/b2b/contracts"),
      api("/api/b2b/orders")
    ]).then(function (res) {
      state.me = res[0].user; state.quotes = res[1].quotes || []; state.rmas = res[2].rmas || [];
      state.contracts = res[3].contracts || []; state.orders = res[4].orders || [];
      renderAll();
    }).catch(function (e) {
      console.warn("[ADS Portal]", e.message);
      localStorage.removeItem(TOKEN_KEY); state.me = null; setSession();
    });
  }

  document.addEventListener("click", function (e) {
    var tab = e.target.closest("[data-tab]");
    if (tab) {
      document.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("active", b === tab); });
      document.querySelectorAll(".panel").forEach(function (p) { p.classList.toggle("active", p.id === tab.dataset.tab); });
    }
    ["approve", "reject", "po", "sign", "reorder"].forEach(function (action) {
      var btn = e.target.closest("[data-" + action + "]");
      if (!btn) return;
      var id = btn.dataset[action];
      var paths = {
        approve: ["/api/b2b/quotes/" + id + "/approve", "POST"],
        reject: ["/api/b2b/quotes/" + id + "/reject", "POST"],
        po: ["/api/b2b/quotes/" + id + "/convert-to-po", "POST"],
        sign: ["/api/b2b/contracts/" + id + "/sign", "POST"],
        reorder: ["/api/b2b/cart-templates/" + id + "/reorder", "POST"]
      };
      btn.disabled = true;
      api(paths[action][0], { method: paths[action][1] }).then(load).finally(function () { btn.disabled = false; });
    });
  });
  $("save-token").onclick = function () {
    localStorage.setItem(TOKEN_KEY, $("token-input").value.trim());
    load();
  };
  $("quote-form").onsubmit = function (e) {
    e.preventDefault();
    var data = Object.fromEntries(new FormData(e.target).entries());
    data.items = data.items.split(/\n|,/).map(function (line) { return { description: line.trim(), quantity: 1 }; }).filter(function (x) { return x.description; });
    api("/api/b2b/quotes", { method: "POST", body: JSON.stringify(data) }).then(function () { e.target.reset(); return load(); });
  };
  $("rma-form").onsubmit = function (e) {
    e.preventDefault();
    api("/api/b2b/rmas", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) }).then(function () { e.target.reset(); return load(); });
  };
  if (token()) load(); else setSession();
})();
