# ADS Tech — Enhancement Pass (2026-07-01)

## What changed

### Performance
- **WebP everywhere**: all 62 product cards now serve `.webp` via `<picture>` with automatic JPG/PNG fallback. The `.webp` files were already in the repo — just never wired up.
- **Lazy loading**: every card image gets `loading="lazy" decoding="async"` — the page no longer downloads the entire catalog's imagery on first paint.
- **Zero layout shift**: explicit `width`/`height` on all 62 images (CLS fix).
- **64 duplicate WhatsApp SVGs → 1 sprite** (`<symbol id="wa-i">` + `<use>`): index.html dropped ~58 KB.
- **Font preconnect** to fonts.googleapis.com / fonts.gstatic.com.

### Premium Dark Glassmorphic Theme (new)
- `theme-dark.css` — full dark theme driven by CSS variables + `html[data-theme="dark"]`.
- **Dark is default**; a toggle button in the nav switches to light, choice persists in localStorage. Anti-flash inline script in `<head>`.
- Glass surfaces: frosted nav, search dropdown, cart/user dropdowns, sidebar.
- Product tiles stay light so products keep the clean "floating" look (`object-fit: contain` zone), fading into the dark card body.
- To make **light** the default: change `"dark"` to `"light"` in the inline head script and in `enhance.js`.

### PWA (new)
- `manifest.webmanifest` + icons (`img/icon-192.png`, `img/icon-512.png`) — installable on phones.
- `sw.js` — cache-first for images/fonts, network-first for pages, works offline after first visit. Relative scope = GitHub Pages safe.

### Untouched
- All content, copy, prices, WhatsApp links, auth system, cart, portal, backend/ — unchanged.
- catalog.js: only added `decoding="async"` to dynamic card images.

## New files
`theme-dark.css` · `enhance.js` · `sw.js` · `manifest.webmanifest` · `img/icon-192.png` · `img/icon-512.png`

## Deploy
```bash
# from your local clone of ads-tech-store
# copy the enhanced files over, then:
git add -A
git commit -m "perf: webp+lazy images, svg sprite; feat: dark glass theme, PWA"
git push origin main
```
GitHub Pages redeploys automatically (~1 min). Hard-refresh (Ctrl/Cmd+Shift+R) to bypass the old cache.
