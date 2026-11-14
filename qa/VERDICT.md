# QA verdict: voxloom-site #11 @ 85da191aacfcc503eee1ffb36687839097ab7093

**CONDITIONAL PASS, residual risk MEDIUM**

- Repo: voxloom-app/voxloom-site
- PR: https://github.com/voxloom-app/voxloom-site/pull/11
- Head (start 1:26:05 PM ET and end recorded in `logs/sha-end.txt`, America/New_York, Friday Nov 13, 2026): `85da191aacfcc503eee1ffb36687839097ab7093`
- Base / current `origin/main`: `1b73cf2008533e66958bf078cc2422c8e01f2be1` (main has not moved during this pass)
- `gh pr view 11 --repo voxloom-app/voxloom-site --json headRefOid` matched this SHA at the start of the pass (end check in `logs/sha-end.txt`)

Read-only box QA: plain `gh`, fresh clone under `/tmp/qa-site11/src`, main worktree at `1b73cf2`, Node v24.20.0, system Chrome 156.0.8078.47 headless (no browser download), rsvg-convert 2.62.4, cairosvg 2.9.1, Pillow 13.0.0 in a `/tmp/qa-site11/venv`. No pushes, GitHub comments, workflow reruns, deploys, merges, or agent messages from this pass.

Evidence: `/workspace/qa-ui/site11/85da191/` (`VERDICT.md`, `renders/`, `logs/`).

## Result

The PR keeps `favicon.svg`, `favicon.ico`, and `apple-touch-icon.png` byte-identical to main in source and in the built `public/`. It adds opaque `icon-192.png` / `icon-512.png`, a valid `manifest.webmanifest`, and a `sizes=192x192` PNG `rel=icon` link (placed after the ICO link and **before** the SVG link) plus `<link rel="manifest">` on all four pages.

On the box, 30/30 tests pass (5 new in `tests/favicon.test.mjs`; main is 25/25), `npm run check` and `npm run build` are green, and CI Site checks run 43482173599 is success at this SHA.

Desktop tab composites of the unchanged SVG and ICO, at 16 and 32 CSS px, DPR 1 and 2, on `#f2f2f7`, white, and `#292a2d`, are pixel-identical between main and the PR (0 differing pixels in all 24 SVG/ICO cells). Exact-corner spike test (luminance ≥20 darker than the tab background): **0/24** on main and **0/24** on the PR for SVG/ICO. Native ICO frames (16/32/48) also spike in **0/9**. The new `icon-192.png`, rendered the same way as a contrast, spikes in **12/12** — square opaque corners, the #9 desktop defect — but headless Chrome did not fetch it.

Headless Chrome (CDP `Network.requestWillBeSent` and a logging HTTP server, cache disabled) requested only `favicon.svg` and `favicon.ico` on both main and the PR. It did not request `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, or `manifest.webmanifest`. The ICO was fetched on the first page of each origin (`index.html`); the other three pages fetched only the SVG (likely the process-wide favicon service). `chrome://favicon2` rendered a generic globe placeholder on a black page and was not used as evidence. Headless Chrome has no visible tab strip.

A Brave iOS pipeline simulation (icon-192 downscaled to 16pt@3x = 48 px and to 16 px, placed on `#1c1c1e`, `#1c1c1c`, and black) shows **no Kyle-like black frame**. Corners are the tile gradient (`#2a2a38` top / `#0a0a10` bottom). Flattening the current SVG/ICO transparent corners onto black reproduces Kyle's dark frame. My 48 px / `#1c1c1c` render is pixel-identical to Web Dev's `brave-192-to-48.png`. This is a simulation, not real Brave on iOS.

**Residual (why this is conditional, not a clean PASS):** desktop Safari's tab-icon pick could not be checked from the box (no WebKit engine present). The new `rel=icon` PNG with `sizes=192x192` is listed **before** `favicon.svg`. Safari 12+ has only partial SVG favicon support and may prefer a PNG with a `sizes` attribute. If desktop Safari picks `icon-192.png` for the tab, the opaque square corners would return — the same class of bug #9 introduced and #10 reverted. That path is **UNTESTED**, not a box failure, and is the MEDIUM residual risk (CR finding 1).

## Checks

### (e) Tests, check, build — PASS

- PR @ `85da191`: `node --test tests/*.test.mjs` / `npm test`: **30/30 pass**, 0 fail
- `npm run check`: 30/30 plus `OK: no PLACEHOLDER markers found.`
- `npm run build`: `Built 13 static files in public/` (main builds 10)
- Main @ `1b73cf2`: **25/25** tests, check and build green
- New tests (5), all in new file `tests/favicon.test.mjs`:
  1. `favicon.svg` is byte-identical to the #8 asset
  2. `favicon.ico` is byte-identical to the #8 asset
  3. `icon-192.png` and `icon-512.png` are opaque full-bleed tiles
  4. `manifest.webmanifest` is valid and its icon files exist
  5. every page links the manifest and keeps the #8 icon markup plus the 192 PNG
- Logs: `logs/npm-pr-test-check-build.log`, `logs/npm-main-test-check-build.log`

### (0) Diff, bytes, manifest, links — PASS

`git diff 1b73cf2 85da191 --stat`:

```
 changelog.html         |   2 +
 download.html          |   2 +
 icon-192.png           | Bin 0 -> 8605 bytes
 icon-512.png           | Bin 0 -> 28787 bytes
 index.html             |   2 +
 manifest.webmanifest   |  18 ++++++
 privacy.html           |   2 +
 scripts/site-build.mjs |   3 +-
 tests/favicon.test.mjs | 164 +++++++++++++++++++++++++++++++++++++++++++++++++
 tests/site.test.mjs    |   3 +-
 vercel.json            |  13 +++-
 11 files changed, 206 insertions(+), 3 deletions(-)
```

SHA-256 (source and built `public/` are identical for each file):

| File | sha256 | Bytes | main vs PR |
|---|---|---|---|
| favicon.svg | `d7cbf5bb0dabf577f5faf484bd896e0b407b7b42b573bd4632a921d94340cb52` | 1267 | identical |
| favicon.ico | `63ab5b798ad60428ef9533ad3a43cfe16c529aaa81670d787864dd0544f1a371` | 4480 | identical |
| apple-touch-icon.png | `4b352daeb0b633dd58fe0e3d09d1b4d21bb07065d3353fbbf33ca2eb44b308f8` | 8394 | identical |
| icon-192.png | `3dd17e4e55daed84ce5ba9155aefbc1e951eda7b9ea1da213de015a1570e6012` | 8605 | PR only |
| icon-512.png | `fcecc89172aff4c073248d9bd609941f0ac9b8f3290b46362f9c665181bbf1cb` | 28787 | PR only |
| manifest.webmanifest | `e7e7164e22096082cb1dedba5b82d5fa7d7df32bcb0d5b7a30ff229e95208277` | 317 | PR only |

- `icon-192.png`: 192×192, mode RGB (no alpha channel), min alpha 255 (opaque). Corners (42,42,56) ≈ `#2a2a38` top, (10,10,16) ≈ `#0a0a10` bottom.
- `icon-512.png`: 512×512, RGB, min alpha 255, same corner colors.
- `apple-touch-icon.png`: 180×180, RGB, also fully opaque with the same corner colors; byte-identical to main (not the same file as icon-192).
- Manifest is valid JSON. `icons[].src` / `sizes` match the real PNG dimensions (192×192, 512×512). `name`/`short_name` Voxloom, `theme_color` and `background_color` `#07070b`. `vercel.json` sets `Content-Type: application/manifest+json; charset=utf-8` for `/manifest.webmanifest`.
- All four pages (index, download, privacy, changelog), source and built, contain this link order:

```html
<link rel="icon" href="favicon.ico" sizes="any">
<link rel="icon" href="icon-192.png" type="image/png" sizes="192x192">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
```

The 192 PNG `rel=icon` comes **before** the SVG link. Pages do not `rel=icon` `icon-512.png` (manifest-only). `<link rel="manifest" href="manifest.webmanifest">` is valid. Main pages have only the ico, svg, and apple-touch links.

Log: `logs/bytes-png-links.json`.

### (a) Desktop tab renders — PASS (SVG/ICO); 192 contrast shows the Safari risk

Luminance = 0.2126R+0.7152G+0.0722B. A "dark spike" is an exact corner pixel ≥20 lum darker than the background. Built `public/` of main and of the PR were served on local HTTP servers. Direct rasters: SVG via rsvg-convert (primary; same as Web Dev), ICO via the file (see native-frame note), composited on `#f2f2f7`, `#ffffff`, and `#292a2d` at 16 and 32 CSS px, DPR 1 and 2.

- Main vs PR, SVG and ICO: **0 pixel differences** in all 24 cells (max channel Δ = 0). `identical_main_pr_svg_ico: true`.
- Spikes, SVG+ICO: **main 0/24, PR 0/24**. Exact corners of the SVG (and of native ICO frames) match the tab color (ΔL = 0) or, for 48-downscaled ICO at 16 CSS DPR 1, a small AA fringe — not a dark spike.
- `icon-192.png` contrast (not the observed Chrome pick): **12/12 spiked**. On light/white, all four corners are the tile gradient (top ≈ (42,42,56), bottom ≈ (10,10,16)). On `#292a2d`, top corners nearly blend (ΔL ≈ 0 to +1) and bottom corners are ≈31 lum darker — the same "dark spikes" pattern as #9.
- Native ICO directory (Pillow only exposes the 48×48 frame on `Image.open`; the file actually has PNG frames 16, 32, and 48). Native-frame composites: **0/9 spikes**, main vs PR pixel-identical, exact corners equal the background. 16/32 native vs 48-downscale differ in AA (expected) but both are rounded with transparent corners. Early 16/32 ICO cells in the contact sheet used the 48-downscale method, which is pixel-identical to Web Dev's `desktop-ico-*` renders.
- cairosvg vs rsvg on the same SVG: AA differences (e.g. 35 pixels / max Δ 6 at 16; larger max Δ at 32/64, confined to fringes). Primary evidence uses rsvg, consistent with Web Dev.
- Contact sheets: `renders/contact-desktop-dpr1.png`, `contact-desktop-dpr2.png`, `contact-svg-vs-192.png`. Numbers: `logs/render-analysis.json`.
- Web Dev's `/workspace/qa-ui/voxloom-site-favicon/brave-fix/desktop-{svg,ico}-*` before/after (light and dark, 16/32 CSS, DPR 1 and 2): before = after, and each is pixel-identical to my corresponding main/PR render (`logs/vs-webdev-desktop.json`).

ICO directory (unchanged vs #8/#10): 16×16 min α 0 (4 fully transparent, 28 partial); 32×32 (24 trans, 56 partial); 48×48 (68 trans, 84 partial).

### (b) Icon URLs headless Chrome actually requests — PASS

Chrome 156, `--headless=new`, CDP Network + logging static server (manifest served as `application/manifest+json; charset=utf-8`), cache disabled, 4 s wait after each navigation, all four pages, main origin and PR origin.

**PR** (port 47311):

- `index.html`: `favicon.svg`, `favicon.ico` (plus page/css). No `icon-192.png`, no manifest.
- `download.html`, `privacy.html`, `changelog.html`: `favicon.svg` only.

**Main** (port 35659): the same pattern (svg+ico on index, svg only on the other three pages).

Server access logs match the CDP request lists exactly. Union of icon URLs:

- Main: `/favicon.svg`, `/favicon.ico`
- PR: `/favicon.svg`, `/favicon.ico`

`icon-192.png`, `icon-512.png`, and `manifest.webmanifest` were **not** fetched. Expectation met for Chromium.

`chrome://favicon2/?size=&scale_factor=&page_url=` screenshots are a generic globe centered on a black 780×493 page; crops are empty/black. Not used as evidence of the chosen tab icon. Headless has no tab strip, so "as the browser chooses it" is the network pick plus a direct raster of those files (SVG and ICO). Log: `logs/chrome-requests.json`.

### (c) Brave iOS pipeline simulation — PASS (simulation only)

- `icon-192.png` → 48 px (16pt@3x) and 16 px, LANCZOS, placed on `#1c1c1e`, `#1c1c1c` (Web Dev's Brave tab color), and black.
- PR 48 px corners: (42,42,56) top, (10,10,16) bottom, mid-top (157,157,164). **Not** a Kyle-like black frame (Kyle crop corners are (7,7,9) / (8,8,10), mid-top (35,33,44) — near-black corners around the rounded tile).
- On `#1c1c1e`, bottom corners are 17.7 lum darker than the tab chrome (under the desktop ≥20 spike rule) but they are the tile's own `#0a0a10` edge, not transparency flattened onto black.
- Old behavior (SVG or ICO transparent corners flattened onto black, then placed on the dark grid): corners (0,0,0), dark-frame-like-Kyle = true.
- Kyle's screenshot `/workspace/qa-ui/voxloom-site-favicon/kyle-ios-tabs-dark-edge.jpg` (read-only, 1206×2403) was cropped at (84, 228, 48). That crop is pixel-identical to Web Dev's `kyle-voxloom-48.png`.
- My `icon-192` → 48 on `#1c1c1c` is pixel-identical to Web Dev's `brave-192-to-48.png` (0 differing pixels; also 0 vs the same raster on black or `#1c1c1e` because the PNG is fully opaque). Consistent with `/workspace/qa-ui/voxloom-site-favicon/brave-fix/`.
- Sheets: `renders/contact-brave-ios-sim.png`, `contact-kyle-vs-sim.png`, `kyle-voxloom-icon-crop-8x.png`.
- This is **not** a real Brave-on-iOS result.

### (d) Desktop Safari tab-icon pick (CR finding 1) — UNTESTED

Searched the box, installed nothing:

- No `~/.cache/ms-playwright` (and no `/root` / `/home/box` playwright cache)
- `which epiphany` / `MiniBrowser` / `webkit2gtk`: not found
- `ldconfig -p | grep webkit`: `ldconfig` not present; `dpkg` webkit packages not used for a search beyond Python
- Python `gi.require_version('WebKit2', '4.0')`: `Namespace WebKit2 not available`

Desktop Safari's pick **cannot be checked from the box**. Reasoning only (not a result): Safari 12+ supports SVG favicons only partly, and a PNG `rel=icon` with an explicit `sizes=192x192`, listed before the SVG, may be preferred for the tab icon. If that happens, Safari would show the opaque square-cornered 192 PNG and the #9 desktop square-corner / dark-spike issue would come back on desktop Safari. Marked **UNTESTED**. This is the MEDIUM residual and the reason the verdict is conditional.

### (f) CI — PASS

`gh run list --repo voxloom-app/voxloom-site --commit 85da191aacfcc503eee1ffb36687839097ab7093` (did not use `gh pr checks`):

- Run **43482173599**, workflow "Site checks", event `pull_request`, head SHA matches, conclusion **success**, job `site` 10s (ID 132081161977)
- URL: https://github.com/voxloom-app/voxloom-site/actions/runs/43482173599
- Created 1:23:28 PM ET, completed 1:23:41 PM ET, Friday Nov 13, 2026 (America/New_York)
- Steps included `npm ci --ignore-scripts`, `npm run check` (which runs the tests), and `npm run build`
- Annotations: Node.js 20 deprecation warning and ubuntu-latest → 26 migration notice only; not failures

## Findings

1. **MEDIUM (residual, UNTESTED) — desktop Safari may pick `icon-192.png` for the tab.** The PR inserts `<link rel="icon" href="icon-192.png" type="image/png" sizes="192x192">` before the SVG link on every page. Headless Chrome fetched only svg/ico, so Chromium desktop tabs should stay pixel-identical to main. Desktop Safari could not be run here. If Safari prefers the sized PNG, the 192's opaque square corners (12/12 spike in the contrast rasters) would appear in Safari tabs. Ticket home: already CR finding 1; needs a real desktop Safari check (Kyle or a WebKit run).

No box failures. No other findings.

## Not tested

- A real Brave on iOS (the 192 pipeline is a simulation only)
- A real desktop Safari / WebKit tab icon pick (no engine on the box)
- A real desktop Chrome tab strip on Kyle's machine (headless has no tab UI; evidence is network pick + direct rasters)
- Android or PWA install icons (icon-512 / manifest install)
- Favicon caching in browsers that still have the #9 or #10 icon cached
- Vercel preview (SSO)

## Cleanup

Clone `/tmp/qa-site11/src`, main worktree, venv, Chrome profile, and `node_modules` deleted after this verdict. `pgrep -af publish` recorded in `logs/pgrep-publish.txt`.
