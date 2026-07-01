/* ADS Tech — enhance.js
 * 1. Light/dark theme toggle (persisted, default dark)
 * 2. PWA service-worker registration
 */
(function () {
  "use strict";
  var KEY = "ads_theme";

  function current() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function apply(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(KEY, t); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0b0c10" : "#ffffff");
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
  }

  document.addEventListener("DOMContentLoaded", function () {
    apply(current()); // sync button/meta with early-set attribute
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.addEventListener("click", function () {
      apply(current() === "dark" ? "light" : "dark");
    });
  });

  /* PWA — relative path keeps the /ads-tech-store/ GitHub Pages scope */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
