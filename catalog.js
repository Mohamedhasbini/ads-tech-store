/* ADS Tech catalog — hybrid mode.
 * Static cards in index.html are the primary catalog.
 * If the backend is reachable, any NEW products not already in the static
 * grid are appended. Static cards are never removed or replaced.
 */
(function () {
  "use strict";
  var API = (window.ADS_API || "https://ads-tech-store-production.up.railway.app").replace(/\/$/, "");
  var WA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

  function esc(s) { return (s == null ? "" : "" + s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function slugify(b, n) {
    return (b + " " + n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  function hasCard(grid, p) {
    var slug = p.slug || slugify(p.brand || "", p.name || "");
    if (slug && grid.querySelector('[data-slug="' + slug + '"]')) return true;
    var key = slugify(p.brand || "", p.name || "");
    return Array.prototype.some.call(grid.querySelectorAll(".pc"), function (card) {
      var b = (card.querySelector(".pc-brand") || {}).textContent || "";
      var n = (card.querySelector(".pc-name") || {}).textContent || "";
      return slugify(b.trim(), n.trim()) === key;
    });
  }
  function placeholder(p) {
    return '<div class="pc-ph" role="img" aria-label="' + esc((p.brand || "ADS TECH") + " product image pending") + '">' +
      '<svg class="ph-icon" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="10" width="40" height="28" rx="3" fill="none" stroke="#0b0c0f" stroke-width="2"/><circle cx="17" cy="22" r="4" fill="none" stroke="#0b0c0f" stroke-width="2"/><path d="M4 34l10-9 7 7 6-5 17 12" fill="none" stroke="#0b0c0f" stroke-width="2" stroke-linejoin="round"/></svg>' +
      '<span class="pc-ph-b">' + esc(p.brand || "ADS TECH") + '</span>' +
      '<span class="pc-ph-n">Photo on request</span></div>';
  }
  function wireFallback(card, p) {
    var img = card && card.querySelector(".pc-img img");
    if (!img) return;
    img.addEventListener("error", function () {
      var wrap = img.parentNode;
      if (wrap) wrap.innerHTML = placeholder(p);
    }, { once: true });
  }

  function card(p) {
    var badge = (p.show_low_stock && p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold || 2))
      ? '<div class="pc-badge" style="background:#b35900">Only ' + p.stock_qty + ' left</div>' : '';
    return '<div class="pc" data-c="' + esc(p.category) + '" data-slug="' + esc(p.slug || slugify(p.brand || "", p.name || "")) + '">' +
      '<div class="pc-img">' + badge +
      (p.img ? '<img src="' + esc(p.img) + '" alt="' + esc(p.brand + " " + p.name) + '" loading="lazy">'
             : placeholder(p)) +
      '</div>' +
      '<div class="pc-info"><div class="pc-brand">' + esc(p.brand) + '</div>' +
      '<div class="pc-name">' + esc(p.name) + '</div>' +
      '<div class="pc-specs">' + esc(p.specs) + '</div></div>' +
      '<div class="pc-trust"><span class="dot"></span> In Stock &nbsp;|&nbsp; Genuine &nbsp;|&nbsp; 1-yr Warranty</div>' +
      (p.price ? '<div class="pc-price"><span class="cur">$</span>' + esc(String(p.price).replace(/^\$/,'')) + '</div>' : '') +
      '<a href="#" class="pc-wa" target="_blank" rel="noopener">' + WA_SVG + ' Request a quote</a></div>';
  }

  function render(products) {
    var grid = document.getElementById("pgrid");
    if (!grid) return;
    var items = products.filter(function (p) { return p.kind !== "service"; });
    if (!items.length) return;

    items.forEach(function (p) {
      if (!hasCard(grid, p)) {
        grid.insertAdjacentHTML("beforeend", card(p));
        wireFallback(grid.lastElementChild, p);
      }
    });
    Array.prototype.forEach.call(grid.querySelectorAll(".pc"), function (card) {
      var brand = (card.querySelector(".pc-brand") || {}).textContent || "ADS TECH";
      var name = (card.querySelector(".pc-name") || {}).textContent || "Product";
      var category = card.dataset.c || "hardware";
      if (!card.dataset.slug) card.dataset.slug = slugify(brand.trim(), name.trim());
      wireFallback(card, { brand: brand.trim(), name: name.trim(), category: category });
    });

    var fg = document.getElementById("featured-grid");
    if (fg) fg.innerHTML = "";
    try { if (window.enhanceCards) window.enhanceCards(); } catch (e) {}
    try { if (window.buildFeatured) window.buildFeatured(); } catch (e) {}
    var total = grid.querySelectorAll('.pc').length;
    var cnt = document.getElementById("cnt");
    if (cnt) cnt.textContent = total + " products · request a quote on WhatsApp";
  }

  function boot() {
    fetch(API + "/api/products")
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.products) render(d.products); })
      .catch(function () { /* offline: static cards stay */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
