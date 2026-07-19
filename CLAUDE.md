# CLAUDE.md — Instructions for AI Coding Agents

This file is the operating manual for any AI agent working in this repository. Read it before doing anything else.

## Project at a glance

A single-page, no-backend web app that lets the user pin cities on a world map and export the view as a PNG. Runs locally in the browser. See `PROJECT.md` for full scope.

## What's shipped (as of 2026-05-10)

All four milestones — Core (CORE-001 → CORE-012), Nice-to-have (NICE-001 → NICE-007), and Hardening (HARDEN-001 → HARDEN-012) — are `Done`. The app supports:

- MapLibre GL JS map with 7 basemap styles via a hybrid registry (HARDEN-009/011): 4 vector styles from OpenFreeMap (Liberty/Positron/Dark/Bright) and 3 raster providers retained from HARDEN-007 (Wikimedia, OpenTopoMap, Esri Satellite — wrapped as MapLibre raster-source styles). Switchable from the header; markers and the route polyline are preserved across style swaps via a `styledata` re-add.
- Markers as a WebGL layer (GeoJSON source + circle layer). Group color override is materialized into each feature's properties at render time and read by the layer's paint expression — single source of truth, no per-marker imperative recolor.
- Nominatim search with debounce, ≥1 req/sec gating, per-tab cache, and abort-on-newer-keystroke. New pins default to a short, city-only label derived from `addressdetails` (HARDEN-004; the country suffix was dropped in the pin-style/label-fixes batch); the user can still rename freely.
- Pin CRUD: add (via search), inline rename, per-pin color picker, delete. Pins themselves are fixed (not draggable); only the pin's label/title is draggable, via a per-pin `labelDx`/`labelDy` screen-px offset.
- Groups (NICE-004/005): independent store with name + color, assignable per pin. Group color overrides the pin's own color while assigned. Deleting a group cascades `pin.group → null`.
- Optional connecting polyline ordered by `createdAt` (header toggle), rendered as a MapLibre line layer underneath the pins layer.
- PNG export via native HTML5 Canvas (HARDEN-010): `map.getCanvas() → drawImage` into an off-screen 2D canvas + a title strip drawn via `ctx.fillText`. No external library, no DOM walk. 7 size presets (Current view, 1080² square, 1920×1080, A4 portrait/landscape, A3 portrait/landscape — all 96 dpi). Inline progress indicator (HARDEN-003) preserved.
- JSON backup and restore (HARDEN-001) via Export/Import buttons in the side panel. The file holds only `pins` and `groups`; UI preferences are intentionally excluded.
- Persistence: every preference (pins, groups, map style, route toggle, export text, export format) lives in its own `localStorage` key prefixed `city-pin-map.…v1`.
- macOS double-clickable launcher (`start.command`, HARDEN-002) running `python3 -m http.server` from the project folder, with port fallback 8000 → 8010.
- Expanded basemap registry: 22 additional styles across three free-tier providers (Stadia for Stamen Watercolor/Toner family, MapTiler for the modern catalog incl. Satellite Hybrid, Thunderforest for cycling/transit/landscape). Native `<select>` replaced by a searchable popover picker (`js/style-picker.js`); per-provider API keys live in a settings modal (`js/settings-panel.js`) backed by a new pub/sub store (`js/settings.js`). Style swaps now route through `setStyleSafely()` which races `styledata` (success) vs `error` (failure) with a 5s timeout — failed swaps revert to the previously-rendered style without persisting the bad choice, so reload always boots into a known-working state.
- Polished drop-pin markers (PO-003) and per-pin label rendering (PO-002): pins render as SVG silhouettes via a single MapLibre `symbol`-type layer with `icon-color` SDF tinting from `effectiveColor()` and a programmatic white halo (`icon-halo-color`/`icon-halo-width`/`icon-halo-blur`) replacing PO-003's two-image stack. Labels sit on a sibling `symbol` layer above the pins layer, reading `text-field` from the same source.
- Pin icon library (PIL-001, this milestone): one neutral built-in (`circle`) intentionally — the user grows their own library through the add-icon flow rather than picking from a curated set, since pre-shipped icons rarely match a personal map's vibe. Replaced PI-001's per-row popover with a modal hosted in `js/icon-picker.js`. New module `js/icons.js` is the registry — merging built-in icons (`BUILTIN_ICONS`) with user-uploaded custom icons (`js/user-icons.js`, `localStorage` key `city-pin-map.user-icons.v1`). Users add custom icons via a sub-view in the modal: file drop, textarea paste, or URL field (URL is attribution-only — never fetched, since browser CORS + Flaticon login wall make download impossible from a no-backend page). New module `js/svg-ingest.js` sanitizes incoming SVG via an allowlist (rejects `<script>`, `<foreignObject>`, `on*` handlers, `javascript:` hrefs; allows `data-*` and `aria-*` so Heroicons-shaped uploads work verbatim) and returns a tintable heuristic. Hybrid color: tintable icons (the entire starter set, monochrome user uploads) keep the SDF + halo treatment; non-tintable icons render in original colors with a circle layer underneath (`pins-color-ring`) showing group/pin color so the group-color contract stays visible. Backup format bumped v1 → v2 with `userIcons` included; v1 backups still import (user-icon library left untouched on v1 import, same as API keys). Sprite-id namespacing under `city-pin-map.icon.<id>` keeps the registry collision-free against basemap atlases. Per-pin appearance now uses two side-by-side affordances in each pin row: an icon tile (opens modal) + a small native color swatch (opens browser color picker).
- Import pins from a CSV or JSON file (PO-004): a new "Import from file" button (side panel, next to Export JSON / Import JSON) accepts `.csv` and `.json` and turns rows into pins, delegating anything shaped like the app's own backup format to the existing `importFromJson()` (HARDEN-001) rather than duplicating it. New module `js/import-foreign.js` owns CSV parsing (a small hand-rolled RFC4180-ish tokenizer — quoted fields, embedded commas, CRLF/LF, UTF-8 BOM strip) and foreign-JSON shape detection (array of `{name,lat,lon}` objects, or array of bare city-name strings). Rows without valid coordinates (including blank/`null` cells and out-of-range values, which are treated as "not provided" rather than a `(0,0)` pin) are geocoded sequentially through the existing `js/geocode.js` wrapper, so Nominatim's rate gate is never bypassed; a confirm dialog precedes the batch and a completion summary reports successes plus any un-geocodable names. `DEFAULT_PIN_COLOR` moved from `search.js` to `pins.js` (and is now exported) so both add-pin paths share one source of truth.
- Fixed on-map title anchor loss on partial updates (FBL-001): `mapTitle.update()` now merges `lon`/`lat` over the existing anchor like every other field, so editing the title text or toggling bold/italic/font/color/size after dragging the overlay no longer resets it to map center or persists a corrupted position.
- Decorative export frame (PO-007) now renders live on the map, fully WYSIWYG, and gained `padding`/`margin`/`radius` config alongside the existing `thickness`/`color`/`shadow` — all three new fields default 0, clamp 0–200 in `normalizeFrame()` (`js/storage.js`), and tolerate partial/corrupt saved objects like every other field. The frame is a **floating band** drawn ONTO the map (not a canvas-growing mat): the map shows through everywhere except the coloured band. `margin` insets the band from the edge, `thickness` is the band width, `radius` its outer corner; `padding` is a transparent inner gap. `wrapFrame()` (`js/export.js`) keeps the output map-sized and paints the band as one even-odd fill (outer rounded rect minus inner rounded rect, via the shared `addRoundedRectSubpath()` helper), with the shadow cast by the ring shape itself onto the map along both edges. The live overlay (`js/map-frame.js`) mirrors this 1:1 with a single bordered ring div plus a `filter: drop-shadow`.
- Full-app review round FBL-009…023 (2026-07-18): boot path now resolves token-style API keys and surfaces first-load style failures (with a swap-cancel guard so a slow-arriving success can't clobber a later revert); export always settles (no stuck progress indicator on failure), re-projects the on-map title after preset resize, and consumes live frame + title state instead of stale snapshots; `js/storage.js` gained load-time element normalization for pins/groups/user icons, a corrupt-byte stash under `<key>.corrupt` so bad `localStorage` values are recoverable instead of silently dropped, and an atomic `prewriteImportPayloads()` pre-verify so a backup import can't partially apply. The CSV tokenizer picked up RFC4180 quote-escaping and bare-CR fixes; the file-import summary now counts blank/not-attempted rows and bails early on a geocoding outage instead of grinding through every row; the pin list re-renders safely mid-rename; dropping an unreadable SVG in the icon picker now surfaces feedback instead of failing silently; and the SVG sanitizer's href allowlist was hardened against namespaced attributes. `js/svg-ingest.test.mjs` grew from 19 to 21 cases.
- Side-panel restructure (2026-07-18): the export/on-map-title/frame configuration and the Export PNG button moved out of the top header into a new **Design** tab, which joins **Pins** and **Groups** as the three tabs of the right sidebar (`.app-side`) — Design first and active by default. The header now holds only map controls: city search, basemap picker, "Hide map labels" toggle + notice, and "Show route" toggle. New module `js/side-tabs.js` is content-agnostic ARIA-tabs glue: it shows/hides the three `role="tabpanel"` sections by reading each tab's `aria-controls`, keeps `aria-selected` and roving `tabindex` in sync, supports ArrowLeft/Right/Home/End keyboard nav, and bails defensively if the markup is missing. The active tab persists via `localStorage` key `city-pin-map.side-tab.v1` (default `design`, validated against `design|pins|groups`) through new `loadActiveSideTab`/`saveActiveSideTab` helpers in `js/storage.js`. Every moved control kept its `id`, so `app.js`'s by-id wiring and the live `map-frame.js` / `map-title.js` overlays are unchanged.
- Two independently configured export frames (2026-07-18): the Design tab's "Frame" group became **Frames**, with "Frame 1" and "Frame 2" each keeping the full existing 7-field shape (`enabled`/`thickness`/`color`/`shadow`/`padding`/`margin`/`radius`) — different margins nest the two floating bands (outer band, map gap, inner band) for a double-frame look. Modeled as a frame SET, `{ frames: [frameElement, frameElement] }`, always exactly two elements; `normalizeFrameSet()` (`js/storage.js`) normalizes each element through the existing per-element `normalizeFrame()`. `loadExportFrame()`/`saveExportFrame()` now load/persist the set under the SAME `city-pin-map.export-frame.v1` key — a pre-existing bare single-frame value is migrated into Frame 1 on load, with Frame 2 seeded from its own thin-black-band-at-margin-16 default. `wrapFrame()` (`js/export.js`) loops the enabled elements, painting each band via an extracted `paintFrameBand()` helper (each isolated in its own save/restore so one frame's shadow can't bleed into the other's). The live overlay (`js/map-frame.js`) grew a lazily-created pool of ring divs, one per enabled frame element, replacing the old fixed single-band ring set. `app.js`'s `initExportFrameOptions()` now wires each frame's cluster via a shared `wireFrameControls(suffix)` helper (ids suffixed `-1`/`-2`), skipping a frame defensively if its DOM is missing rather than crashing the whole init.
- Bottom fade (2026-07-18): a new "Bottom fade" group in the Design tab dissolves the map into a solid color (default white) at the bottom edge — a poster-style caption zone for the on-map title. Own standalone `localStorage` key `city-pin-map.bottom-fade.v1`, shape `{ enabled, height, color, intensity }` where `height` is a PERCENTAGE (0–100, default 30) of the map/canvas height rather than a pixel count, so the live preview and every export preset read the same proportion regardless of resolution; `color` defaults `#ffffff`; `intensity` (0–100, default 50) is a further percentage of the band, measured from the bottom edge, that stays fully opaque before the ramp to transparent begins — a 3-stop gradient color-stop split within the same band, not a second band (intensity 0 degrades to the original pure-linear fade). `normalizeBottomFade()`/`loadBottomFade()`/`saveBottomFade()` (`js/storage.js`) mirror the frame's defensive load/clamp/save shape, including backfilling `intensity` to 50 for fades saved before the field existed. The live overlay (`js/map-fade.js`) renders the hold via a 3-stop CSS `linear-gradient` (`color 0%, color intensity%, transparent 100%`); it's a single bottom-anchored div sitting at `z-index: 3` — below the frame overlay (4) and the title overlay (5). `js/export.js`'s `paintBottomFade()` mirrors it 1:1 on the export canvas via a matching 3-stop `ctx.createLinearGradient` (plus a `hexToRgba()` helper), painted between the map pixels and the on-map title so the title always reads on top of the fade; the frame wrap still runs last and stays outermost. The export fast path now also requires the fade to be off (`enabled=false` or `height=0`) before skipping the composite step.
- Export-size live preview (2026-07-18): selecting a non-"current" export-size preset in the Design tab now letterboxes the live `#map` to that preset's aspect ratio — contain-fit and centered within `.app-map`, whose `#dbe2ea` background reads as the letterbox mat — so the on-screen view previews exactly the crop Export PNG will capture; picking "Current view" restores `#map` to fill the whole area. New module `js/map-viewport.js` owns this: `init(map)` wires a `ResizeObserver` on `.app-map` so the fit re-runs on window/panel resizes, and returns `{ setPreset }` for `app.js`'s `initExportFormatSelector()` to call on boot and on every `change`. `.app-map` gained `display:flex` + `overflow:hidden`; `#map` switched from `position:absolute; inset:0` to `position:relative; width:100%; height:100%` (so it can be flex-centered) plus a subtle `box-shadow` so the letterboxed area reads as a canvas against the mat. The viewport's `apply()` guards against `js/export.js`'s `captureFramed()` temporarily reparenting `#map` off-screen during a PNG capture — it no-ops whenever `#map`'s parent isn't `.app-map` — so the live-preview fit can never fight the export's own resize, and `captureFramed`'s existing inline-style save/restore already round-trips the letterboxed size correctly with no changes needed there.
- Global pin style + label-culling fix + city-only pin names (2026-07-19): a new Design-tab "Pin style" group (`size`, `labelSize`, `labelColor`, `labelBold` — no font-family picker, see below) applies uniformly to every pin via `js/map.js`'s exported `setPinStyle(pinStyle)`, persisted at `city-pin-map.pin-style.v1` (`loadPinStyle`/`savePinStyle`/`normalizePinStyle` in `js/storage.js`; defaults `size:32, labelSize:13, labelColor:"#1f2937", labelBold:false, labelFont:""` mirror the pre-existing rendering exactly, so migration is a visual no-op). `size` scales `icon-size` (`pinStyle.size / 32`, the baseline the 128px-source/pixelRatio-4 sprites were tuned at) on the pins-fill layer AND the `pins-color-ring` layer's radius/translate/stroke-width in lockstep, so a non-tintable custom icon's color ring stays proportionate. `setPinStyle` is folded into `addPinAndRouteLayers`'s styledata re-add path (module-scoped `currentPinStyle` is what layer (re)creation reads), so a basemap swap never resets a custom style back to default. Export reconciliation: `js/export.js`'s PO-006 label-size-for-capture bump now reads `getPinLabelSize()` (map.js's configured `currentPinStyle.labelSize`) instead of the old hardcoded `BASE_PIN_LABEL_SIZE`, multiplying by the same `coeff` — so a custom label size scales correctly into every export preset, and `setPinLabelSize(null)`'s post-export restore returns to the user's configured size rather than the pre-feature default. Labels-disappearing-on-zoom fix (MapLibre symbol collision culling): the `pins-labels` layer gained `text-allow-overlap: true` / `text-ignore-placement: true` (icons already had the icon- equivalents) so a pin's label is never dropped at any zoom regardless of collisions with basemap POI text or other pins — acceptable overdraw at this app's tens-of-pins scale. Font-family is intentionally NOT wired to a UI control: MapLibre `text-font` can only reference glyphs the active basemap's `glyphs` endpoint serves, and this app's basemaps only guarantee the Noto Sans Regular/Bold pair already used for the Bold toggle (see the `text-font` comment history on the labels layer) — an arbitrary family would 404 the glyph fetch and blank both the labels layer and the pin-icon layer sharing that source. `labelFont` stays in the persisted shape for forward-compat but has no consumer yet (superseded later on 2026-07-19: labels are now a DOM overlay — see the pin-label text parity bullet below; the glyph limitation no longer applies to pin labels). Separately, new pins from search now default to a CITY-ONLY name (`js/search.js`'s `shortName()` dropped the `", ${country}"` suffix HARDEN-004 originally added) — the user can still rename freely.
- Draggable labels, fixed pins (2026-07-19): the pin itself is now permanently fixed in place — `js/map.js`'s old custom mousedown-drag wiring on the pins layer (plus the FBL-008 Alt-gate) is removed entirely, so a mousedown on a pin falls through untouched and the map pans normally. There is no per-pin lock toggle; a pin simply cannot be repositioned by dragging. Only a pin's TEXT LABEL is draggable: `attachPinInteractions()` now wires hover/mousedown only on the `pins-labels` symbol layer, and a drag sets a per-pin `pin.labelDx`/`labelDy` (constant screen-px offset from the pin) through the existing `updatePin` path. The labels layer's `text-offset` became a data-driven expression (`["get", "labelOffset"]`) reading a per-feature `labelOffset` materialized by `pinsToFeatureCollection`'s new `computeLabelOffsetEms(pin)` helper, which divides the stored px offset by the CONFIGURED label size (`currentPinStyle.labelSize`) to get an ems value — ems × text-size is a fixed px value at every zoom, so the label keeps a constant pixel gap from its pin across zoom. `applyPinStyleToLayers()` re-sets the pins source data whenever `labelSize` changes so a global label-size edit re-derives the ems offset from the same stored px, keeping the pixel gap constant rather than letting it scale. The now-orphaned "reset position" pin-list button (FBL-008; only ever shown for an Alt-dragged pin, impossible now that pins can't move) was removed from `js/pin-list.js`, along with its now-dead `.reset-pin` CSS — `pin.originalLat`/`originalLon` stay in the data model (harmless, still stamped on add) but have no current UI reader.
- Inset map ("atlas magnifier", 2026-07-19): a live WYSIWYG corner inset — a second, non-interactive MapLibre map (`preserveDrawingBuffer: true`, lazily created) docked as a square overlay inside `#map` (`js/map-inset.js`), fitted (padding 40, `maxZoom` 10) to the pins of one user-chosen GROUP so a dense cluster (e.g. 10 pins in Bavaria) stays readable while the main map holds continental zoom. Config `{ enabled, corner, sizePct (15–50, % of map width), groupId, showLocator }` persists at `city-pin-map.inset.v1` (`normalizeInset`/`loadInset`/`saveInset` in `js/storage.js`, mirroring the fade's defensive pattern; a stale `groupId` never crashes — the inset just hides itself). The inset seeds its style from the main map's already-resolved `getStyle()` snapshot (app-added layers stripped, API keys never re-resolved) and renders pins via `js/map.js` machinery parameterized to accept a target map (`addPinAndRouteLayers`, `renderPinsTo`, `renderRouteTo` now exported; defaults preserve singleton behavior); it stays live via pins/groups store subscriptions and rebuilds on basemap swaps. The locator rectangle outlining the inset bounds is a real line layer on the MAIN map (`renderLocator`), so exports capture it for free. `js/export.js` mirrors the box 1:1 via `paintInset()` (composited map → fade → inset → title → frame), gives the inset map its own resize/idle wait inside `captureFramed` (a timeout fails the export loudly rather than shipping a torn box), scales the box chrome by the same CSS→output factor as the frame bands (not the typography coeff), and the fast path additionally requires the inset inactive. UI: an "Inset map" group in the Design tab (`inset-enabled`/`inset-group`/`inset-corner`/`inset-size`/`inset-locator`) wired via `initInsetOptions()` in `app.js`; the group select live-updates with the groups store. Overlay z-order restacked: fade 3, inset 4, frame 5, title 6. Known v1 limits: pin-style/user-icon/route-toggle edits reach the inset on the next pin/group change or basemap swap, not instantly; no browser-coverage scenario yet for `map-inset.js`.
- Pin-label text parity with the title (2026-07-19): pin labels moved OUT of the WebGL `symbol` layer into a DOM overlay (`js/map-labels.js`), lifting the basemap glyph-endpoint font restriction — the Design tab's "Pin style" group now offers font family (the on-map title's 7-family list plus "Default (Noto Sans)", id `pin-label-font`) and italic (`pin-label-italic`) alongside size/color/bold; the persisted shape (`city-pin-map.pin-style.v1`) gained `labelItalic: false` (backfilled) and `labelFont` finally has a consumer. `computeLabelSpecs(map, { sizeMultiplier })` is the single source of truth for label geometry+style (anchor via `map.project` + the 1.0-em base below-pin offset + per-pin `labelDx`/`labelDy`; halo carried over: white, width 1.5, blur 0.5). Live overlay: one div per pin in `.map-pin-labels` at z-index 2 — BELOW the fade (3), so the bottom fade covers labels exactly as the WebGL layer was covered; label drag rewired to Pointer Events on the divs (same `labelDx`/`labelDy` store path); the inset map gets a display-only overlay clipped to its box; `setPinStyle` refreshes every attached overlay via `refreshAllLabelLayers()`. `js/export.js` paints labels via `paintPinLabels` — compositing order is now map → pin labels → fade → inset (incl. its own labels inside the rounded-rect clip, transformed by inner-origin + the CSS→output factor) → title → frame — reproducing PO-006's preset size bump by passing the typography coeff as `sizeMultiplier` (font and offsets scale together; `setPinLabelSize` is a dead no-op shim), and the no-composite fast path now additionally requires zero pins since the raw map canvas no longer contains labels. `js/map.js` dropped the `pins-labels` layer, `computeLabelOffsetEms`, and the label hover/drag wiring, and gained exported `getPinStyle()`.

## Considered and parked

Decisions deliberately made and parked. Don't re-evaluate without a concrete trigger — re-litigating in a fresh context wastes hours and ends in the same place.

- **Leaflet + raster-only basemaps.** Replaced by MapLibre GL JS + a hybrid registry in HARDEN-009..012 (cutover authorized 2026-05-08). Reverting would lose: smooth fractional zoom, retina-crisp text on the 4 vector styles, the data-driven group-color paint expression on markers (currently a single layer-paint expression rather than per-marker imperative state), and the canvas-native export pipeline (replacing it with the previous `dom-to-image-more` DOM walk would re-introduce font-tainting risks and the SRI-pinning surface area HARDEN-005 had to mitigate). The previous Leaflet stack is preserved in `git log` and the closed task files HARDEN-001..007 for reference. Trigger to revisit: a real OpenFreeMap outage that exceeds tolerable downtime for personal use, with no quick swap to a peer keyless host (Stadia, MapTiler, etc.) that meets CLAUDE.md hard rule #3.

## Hard rules

1. **No build step.** Plain HTML, CSS, and JavaScript only. No bundlers, no transpilers, no `npm run build`. Libraries are loaded via CDN `<script>` tags.
2. **No backend.** Everything runs client-side. State persists via `localStorage`.
3. **No paid APIs.** Use MapLibre GL JS + OpenStreetMap + Nominatim. Free-tier API keys (Stadia, MapTiler, Thunderforest) are allowed; no paid plans, ever. Keys live in `localStorage` per-user — never inlined in source, never committed to git, never included in JSON backup exports.
4. **Respect Nominatim's usage policy.** Max 1 geocoding request per second, send a meaningful `User-Agent` or `Referer`, and debounce search input.
5. **The app must run by opening `index.html` directly or with a trivial static server** (`python -m http.server`, `npx serve`). If a task requires more than that, stop and flag it.

## File layout (current)

```
city-pin-map/
├── index.html          # Single entry point
├── start.command       # macOS double-clickable launcher (HARDEN-002)
├── css/styles.css      # All styles
├── js/                 # 24 ES modules
│   ├── app.js          # Bootstrap + glue: wires modules in DOMContentLoaded
│   ├── side-tabs.js    # Right-sidebar Design|Pins|Groups tab controller: ARIA tabs, roving tabindex, active-tab persistence
│   ├── map.js          # MapLibre init, basemap registry, `setStyleSafely` swap pipeline, marker fill layer with halo paint, color-ring layer for non-tintable icons, global pin style (`setPinStyle`/`getPinLabelSize`), drag, route layer, effectiveColor()
│   ├── icons.js        # Icon registry: BUILTIN_ICONS + user-icon merge + effectiveIcon() (PIL-001)
│   ├── icon-picker.js  # Modal grid view + add-icon sub-view + per-icon delete with cascade-clear (PIL-001)
│   ├── user-icons.js   # User-icon store: pub/sub + localStorage CRUD (PIL-001)
│   ├── svg-ingest.js   # Pure: sanitize + normalize + tintable heuristic; covered by js/svg-ingest.test.mjs (PIL-001)
│   ├── geocode.js      # Nominatim wrapper: rate-limit gate, in-tab cache, addressdetails fetch
│   ├── search.js       # Search input → debounced geocode → addPin (with short, city-only default name)
│   ├── pins.js         # Pin store: pub/sub, add/remove/update/replaceAll/list — pin.icon optional; owns DEFAULT_PIN_COLOR (PO-004)
│   ├── import-foreign.js # CSV/foreign-JSON import: RFC4180-ish CSV tokenizer, shape detection, sequential geocode loop, delegates app-backup-shaped files to backup.js (PO-004)
│   ├── pin-list.js     # Side-panel pin list (rename, group selector, delete) — appearance composition: icon tile + native color swatch
│   ├── groups.js       # Group store (mirrors pins.js shape)
│   ├── group-panel.js  # Side-panel group list (always-on rename + color, delete cascades to pins)
│   ├── settings.js     # Per-provider API key store (mirrors pins.js pub/sub shape) — Stadia, MapTiler, Thunderforest
│   ├── settings-panel.js # Settings modal renderer: open/close, blur-to-save, status pills, reveal toggle
│   ├── style-picker.js # Searchable popover picker for basemaps (replaces native <select>); locked rows deep-link to settings
│   ├── storage.js      # All localStorage keys + the showError() banner helper — incl. attachUserIconStorage (PIL-001); also owns exported normalizeFrame (FBL-013), boot-time element normalizers for pins/groups/user icons (FBL-014), corrupt-value stash under `<key>.corrupt` (FBL-015), prewriteImportPayloads import pre-verify (FBL-016), and active side-tab persistence via loadActiveSideTab/saveActiveSideTab (key `city-pin-map.side-tab.v1`); also owns the on-map title's PER-LINE shape (`{nx, ny, lines[]}` — normalizeOnMapTitle/normalizeTitleLine/defaultTitleLine), the global pin-style key `city-pin-map.pin-style.v1` (loadPinStyle/savePinStyle/normalizePinStyle), and the export-frame set's `outside` treatment (normalizeFrameOutside, key unchanged: `city-pin-map.export-frame.v1`)
│   ├── backup.js       # JSON export/import for pins + groups + userIcons (v2; v1 still importable, leaves user icons untouched)
│   ├── export.js       # Canvas-merge PNG: getCanvas() → drawImage + on-map title + wrapFrame (margin/band/mat/radius) via ctx, dimension presets, off-screen resize trick
│   ├── map-title.js    # Draggable on-map title overlay (PO-008/009): pointer-capture drag, lon/lat re-projection, formatting toolbar state
│   ├── map-frame.js    # Live WYSIWYG frame overlay: concentric border-rings preview the export frame (margin/band/mat/radius/shadow) on the map
│   ├── map-labels.js   # DOM overlay pin labels (any system font/italic): computeLabelSpecs SSOT, Pointer-Events label drag, factory for the inset's display-only labels; mirrored by export.js's paintPinLabels
│   ├── map-inset.js    # Live WYSIWYG corner inset: second MapLibre map fitted to a group's pins + main-map locator layer; mirrored by export.js's paintInset
│   ├── map-fade.js     # Live WYSIWYG bottom-fade overlay: bottom-anchored CSS gradient div mirroring js/export.js's paintBottomFade on the map
│   └── map-viewport.js # Live WYSIWYG export-size preview: letterboxes #map to the selected export preset's aspect ratio via ResizeObserver + inline width/height, with a reparent guard against js/export.js's off-screen capture
└── assets/
    └── icons/          # 1 SVG: circle.svg (the sole built-in icon — see js/icons.js)
```

Keep modules small and focused. `map.js` is the outlier (~1690 lines — basemap registry + style-swap pipeline + image registration loop + marker/route/color-ring rendering + global pin style + drag, all of which need to share state); `storage.js` is now the second-largest at ~847 lines after picking up the FBL-013..016 hardening (normalizeFrame, boot-time element normalizers, corrupt-value stash, import pre-verify) plus the side-tab persistence helpers, alongside its existing localStorage-key/showError duties; other top files (`export.js`, `icon-picker.js`, `app.js`, `style-picker.js`, `import-foreign.js`, `pin-list.js`) sit roughly 330–645 lines. `side-tabs.js` is a small (~85-line) module — content-agnostic ARIA-tabs glue with no dependency on what's inside each panel. Split when adding new responsibilities, not before.

## Testing

Dev-only tooling — it does NOT add an app build step; the app still runs by opening `index.html`. `package.json` is a `devDependencies`-only manifest. Two coverage layers, both dev-only:

- **Logic layer (fast, node-only).** Tests are `node:test` files co-located as `js/*.test.mjs`, run via `npm test`. `npm run coverage` runs them under `c8`, gating ≥80% aggregate **line** coverage over 11 pure/logic modules (`storage`, `svg-ingest`, `import-foreign`, `pins`, `groups`, `settings`, `user-icons`, `icons`, `geocode`, `backup`, `search`) — currently ~99.7% aggregate. No jsdom — shared shims are `js/test-helpers.mjs` (localStorage/document/fetch/timer stand-ins) and `js/xml-shim.mjs` (DOMParser/XMLSerializer stand-in).
- **Combined whole-repo (browser + node).** `npm run coverage:all` (`test/coverage/run.mjs`) merges the same node V8 coverage with Playwright headless-chromium browser V8 coverage — via `monocart-coverage-reports` — driving the DOM/WebGL-heavy modules (`map.js`, `export.js`, `app.js`, `icon-picker.js`, `style-picker.js`, `map-frame.js`, `map-title.js`, `pin-list.js`, `group-panel.js`, `settings-panel.js`, `map-viewport.js`, `map-fade.js`, `side-tabs.js`) through interaction scenarios in `test/coverage/scenarios/*.mjs` against a real served `index.html` (`test/coverage/serve.mjs`, a dependency-free static server). Currently ~86% whole-repo line coverage, gated at 80%. Requires `npx playwright install chromium` once locally.

`.github/workflows/coverage.yml` runs both as separate jobs on every push/PR (Node 22): `coverage` (fast, node-only logic-layer gate) and `coverage-full` (installs Playwright chromium, runs the combined whole-repo gate). Both block the workflow under their gate.

## Coding conventions

- **Modules:** Use ES modules (`<script type="module">`). Each `js/` file exports named functions.
- **State:** Single in-memory pin store in `pins.js`. UI subscribes to changes via simple pub/sub or by re-reading after each mutation. No frameworks.
- **DOM:** Vanilla `document.querySelector` and event listeners. No jQuery.
- **Async:** `async/await`, never raw `.then()` chains.
- **Errors:** Always show user-visible feedback for failed geocoding, failed exports, etc. Never silently swallow.
- **Comments:** Explain *why*, not *what*. Code should be readable on its own.
- **Naming:** `camelCase` for variables and functions, `PascalCase` for classes (rare here), `kebab-case` for filenames and CSS classes.

## Libraries (load via CDN)

- `maplibre-gl@4.7.1` — map rendering. Loaded from jsdelivr. SRI hash is currently absent on this tag (HARDEN-009 cutover left it as a known follow-up parallel to HARDEN-005's pattern); re-add when the dependency is treated as production-stable.
- (No PNG export library — native HTML5 Canvas in `js/export.js`. The previous `dom-to-image-more` dependency was retired in HARDEN-010.)

Pin exact versions in `index.html`. Do not introduce new dependencies without a strong reason — note the reason in the task file.

## Pin data model

Every pin must conform to:

```js
{
  id: string,            // crypto.randomUUID()
  name: string,          // user-facing label, defaults to a short, city-only name derived from Nominatim addressdetails (HARDEN-004)
  lat: number,
  lon: number,
  color: string,         // hex like "#e63946" — overridden visually by group color when grouped
  group: string | null,  // group id from the group store, or null
  icon: string | null,   // icon id from the registry (PIL-001); null falls back to DEFAULT_ICON_ID at render time
  createdAt: number,     // Date.now()
  labelDx?: number,      // per-pin label pixel offset from its anchor (screen px), set by dragging the label; optional — absent means 0, never defaulted on add
  labelDy?: number,      // paired with labelDx; same optional/defensive-on-absence contract
  originalLat?: number,  // geocoded origin captured once at creation (FBL-008); the pin itself is fixed in place (never draggable) so no current UI reads this — kept for compatibility with already-persisted data
  originalLon?: number   // paired with originalLat; both optional — absent on pre-FBL-008 pins, never crash on absence (mirrors the stale-group contract)
}
```

Group entity:

```js
{
  id: string,
  name: string,
  color: string,         // hex
  createdAt: number
}
```

User-icon entity (PIL-001, in `localStorage` key `city-pin-map.user-icons.v1`):

```js
{
  id: string,            // crypto.randomUUID()
  name: string,          // user-supplied
  tintable: boolean,     // SDF when true; raster RGBA when false
  fillSvg: string,       // sanitized SVG markup (allowlist-based, no <script>/<foreignObject>/on*)
  attribution: { artistName: string|null, sourceUrl: string|null } | null,
  createdAt: number
}
```

Invariants worth knowing before changing this code:

- A pin's `group` may legitimately reference a now-deleted group at any moment between events; **never crash on stale references**. `effectiveColor()` falls back to the pin's own color, the pin list renders "(none)", and `group-panel.js` cascade-clears the field on group delete.
- A pin's `icon` follows the same contract: `effectiveIcon()` (in `js/icons.js`) clamps to known ids and falls back to `DEFAULT_ICON_ID` (`"map-pin"`). The icon-picker's trash button cascade-clears `pin.icon = null` on delete (parallel to the group cascade in `group-panel.js`).
- `localStorage` is a serializer at save/load points only. The single source of truth during a session is the in-memory pin / group / user-icon store. Reverse the order at hydrate time and you'll overwrite good data with `[]` — see `attachStorage` / `attachUserIconStorage` notes.
- Hydrate stores **before** subscribing UI renderers, then call the renderer once explicitly to backfill the hydration `notify()`. `app.js` does this in a fixed order; preserve it. The icon registry (`js/icons.js`) subscribes to `user-icons$` at module-eval time, so `attachUserIconStorage` must run before any module that triggers a registry rebuild.

Tasks that touch pins, groups, or user icons must preserve these shapes. If a task needs a new field, add it as optional and update this section.

## Task workflow

Two flavors live in this repo, both still active:

**Single-task `jira/` files (CORE / NICE / HARDEN milestones):**

1. Pick a task file from any milestone folder under `jira/` (e.g. `jira/core/`, `jira/nice-to-have/`, `jira/harden/`) whose `Status` is `Todo` and whose dependencies are all `Done`.
2. Set `Status` to `In Progress`.
3. Execute the **Implementation Prompt** at the bottom of the task.
4. Verify against the **Acceptance Criteria** checklist — tick boxes as you go.
5. Set `Status` to `Done` and commit.

**Plan-driven milestones under `docs/superpowers/`:** Larger features (e.g. expanded basemap styles) live under `docs/superpowers/specs/` (design) + `docs/superpowers/plans/` (implementation), with each plan splitting work into checkbox-tracked tasks. Execute these via the `superpowers:executing-plans` or `superpowers:subagent-driven-development` skills. The plan file is the source of truth for "done" within that milestone.

**Agent-orchestrated batch fixes:** When asked to fix one or more findings "using agents", follow the workflow in `jira/agent-fix-findings-workflow.md`. In short: delegate each finding's fix to an **Opus** subagent (it edits + updates the task file, runs no git), then a **Sonnet** subagent build-checks (`node --check` on changed modules + `node --test js/svg-ingest.test.mjs`) and makes ONE commit per finding. One commit per finding; serialize findings that touch the same file; STOP and ask before touching any `Needs review`/unconfirmed finding or a change only verifiable at runtime. The full prompt template lives in that file.

## Definition of done

A task is only `Done` when:

- All acceptance criteria checkboxes are ticked.
- The app still loads and runs without console errors.
- No regressions in previously completed tasks.
- Code follows the conventions above.

## What not to do

- Don't add a backend, database, or server-side logic.
- Don't add a build pipeline, even a "small" one.
- Don't introduce React, Vue, or any framework.
- Don't add user accounts, auth, or cloud sync.
- Don't optimize prematurely. The pin count is small (tens, not thousands).
