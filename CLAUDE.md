# CLAUDE.md — Instructions for AI Coding Agents

This file is the operating manual for any AI agent working in this repository. Read it before doing anything else.

## Project at a glance

A single-page, no-backend web app that lets the user pin cities on a world map and export the view as a PNG. Runs locally in the browser. See `PROJECT.md` for full scope.

## What's shipped (as of 2026-05-10)

All four milestones — Core (CORE-001 → CORE-012), Nice-to-have (NICE-001 → NICE-007), and Hardening (HARDEN-001 → HARDEN-012) — are `Done`. The app supports:

- MapLibre GL JS map with 7 basemap styles via a hybrid registry (HARDEN-009/011): 4 vector styles from OpenFreeMap (Liberty/Positron/Dark/Bright) and 3 raster providers retained from HARDEN-007 (Wikimedia, OpenTopoMap, Esri Satellite — wrapped as MapLibre raster-source styles). Switchable from the header; markers and the route polyline are preserved across style swaps via a `styledata` re-add.
- Markers as a WebGL layer (GeoJSON source + circle layer). Group color override is materialized into each feature's properties at render time and read by the layer's paint expression — single source of truth, no per-marker imperative recolor.
- Nominatim search with debounce, ≥1 req/sec gating, per-tab cache, and abort-on-newer-keystroke. New pins default to a short `"city, country"` label derived from `addressdetails` (HARDEN-004); the user can still rename freely.
- Pin CRUD: add (via search), drag (custom MapLibre `mousedown` wiring on the pin layer + document-level `mousemove`/`mouseup` commit), inline rename, per-pin color picker, delete.
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
├── js/                 # 19 ES modules
│   ├── app.js          # Bootstrap + glue: wires modules in DOMContentLoaded
│   ├── map.js          # MapLibre init, basemap registry, `setStyleSafely` swap pipeline, marker fill layer with halo paint, color-ring layer for non-tintable icons, drag, route layer, effectiveColor()
│   ├── icons.js        # Icon registry: BUILTIN_ICONS + user-icon merge + effectiveIcon() (PIL-001)
│   ├── icon-picker.js  # Modal grid view + add-icon sub-view + per-icon delete with cascade-clear (PIL-001)
│   ├── user-icons.js   # User-icon store: pub/sub + localStorage CRUD (PIL-001)
│   ├── svg-ingest.js   # Pure: sanitize + normalize + tintable heuristic; covered by js/svg-ingest.test.mjs (PIL-001)
│   ├── geocode.js      # Nominatim wrapper: rate-limit gate, in-tab cache, addressdetails fetch
│   ├── search.js       # Search input → debounced geocode → addPin (with short "city, country" name)
│   ├── pins.js         # Pin store: pub/sub, add/remove/update/replaceAll/list — pin.icon optional; owns DEFAULT_PIN_COLOR (PO-004)
│   ├── import-foreign.js # CSV/foreign-JSON import: RFC4180-ish CSV tokenizer, shape detection, sequential geocode loop, delegates app-backup-shaped files to backup.js (PO-004)
│   ├── pin-list.js     # Side-panel pin list (rename, group selector, delete) — appearance composition: icon tile + native color swatch
│   ├── groups.js       # Group store (mirrors pins.js shape)
│   ├── group-panel.js  # Side-panel group list (always-on rename + color, delete cascades to pins)
│   ├── settings.js     # Per-provider API key store (mirrors pins.js pub/sub shape) — Stadia, MapTiler, Thunderforest
│   ├── settings-panel.js # Settings modal renderer: open/close, blur-to-save, status pills, reveal toggle
│   ├── style-picker.js # Searchable popover picker for basemaps (replaces native <select>); locked rows deep-link to settings
│   ├── storage.js      # All localStorage keys + the showError() banner helper — incl. attachUserIconStorage (PIL-001)
│   ├── backup.js       # JSON export/import for pins + groups + userIcons (v2; v1 still importable, leaves user icons untouched)
│   └── export.js       # Canvas-merge PNG: getCanvas() → drawImage + title strip via ctx.fillText, dimension presets, off-screen resize trick
└── assets/
    └── icons/          # 1 SVG: circle.svg (the sole built-in icon — see js/icons.js)
```

Keep modules small and focused. `map.js` is the outlier (~1140 lines — basemap registry + style-swap pipeline + image registration loop + marker/route/color-ring rendering + drag, all of which need to share state); `icon-picker.js` is next at ~590 lines (modal grid + add-icon sub-view + sanitize/preview wiring); other top files (`export.js`, `style-picker.js`, `storage.js`, `app.js`) sit around 250–430 lines. Split when adding new responsibilities, not before.

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
  name: string,          // user-facing label, defaults to short "city, country" derived from Nominatim addressdetails (HARDEN-004)
  lat: number,
  lon: number,
  color: string,         // hex like "#e63946" — overridden visually by group color when grouped
  group: string | null,  // group id from the group store, or null
  icon: string | null,   // icon id from the registry (PIL-001); null falls back to DEFAULT_ICON_ID at render time
  createdAt: number,     // Date.now()
  originalLat?: number,  // geocoded origin captured once at creation (FBL-008); powers the pin-list "reset position" affordance for Alt-dragged pins
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
