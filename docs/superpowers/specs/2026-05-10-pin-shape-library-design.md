# Pin shape library — design

**Status:** Approved
**Date:** 2026-05-10
**Predecessors:** PO-003 (drop-pin markers, Done) and PI-001 / 2026-05-09 pin-icon-picker design (Done — implemented in the codebase even though the spec listed its Successor as "implementation plan TBD"; superseded for design intent — see [history](#relationship-to-the-2026-05-09-design))
**Successor:** _implementation plan in `docs/superpowers/plans/2026-05-10-pin-shape-library.md`_

**Terminology note:** This spec was drafted using "shape" throughout. The shipped PI-001 code uses "icon" for the same concept (`pin.icon`, `PIN_ICONS`, `effectiveIcon(pin)`). The implementation plan and codebase keep the existing **icon** naming to avoid a broad rename for no functional benefit. The two terms refer to the same thing in this document.

## Goal

Let the user choose a marker shape per pin from a curated starter set of ~25 shapes, AND let the user grow that set over time by importing custom SVG icons (e.g. from Flaticon) that persist in `localStorage` across sessions. Builds on PO-003's symbol-layer marker pipeline. Reuses the SDF tinting contract so per-pin and per-group colors keep flowing through unchanged for shapes that opt in. Allows full-color custom art for shapes that opt out, with a small group-color ring underneath to keep the group-color contract visible.

## Non-goals

- **Per-pin emoji-or-glyph-inside-a-pin** (Google Maps style with a shape underneath a glyph). Different feature; would need a fourth visual axis. Reopen if asked.
- **Marker clustering at low zoom.** Pin counts in this app are tens, not thousands.
- **Editing an existing user-icon's metadata.** Delete + re-add. Editing in place is small UI weight that v1 doesn't need.
- **Shape per group** (all pins in a group share a shape). Pins own their `shape` field individually. Reopen if a user asks.
- **Animations on shape change.** Pins should feel solid (PO-003 already established).
- **Importing icon packs from a URL or JSON manifest.** The user-add flow is one-at-a-time on purpose.
- **Per-pin size override.** Every shape renders at the same on-screen size for legend readability.
- **A "Reset all pins to default shape" bulk action.** Not asked for.

## Relationship to the 2026-05-09 design

The 2026-05-09 spec (`pin-icon-picker-design.md`) was approved but no implementation plan was written. This spec supersedes it. Two ideas from the 2026-05-09 design are carried forward unchanged because they're load-bearing improvements:

1. **`icon-halo-*` paint replaces the shadow companion.** PO-003's two-image stack (non-SDF shadow underneath the SDF fill) was correct for one shape but scales poorly to N shapes. MapLibre's `icon-halo-color` / `icon-halo-width` / `icon-halo-blur` paint properties on an SDF symbol layer give the same visual register (white inner contour + soft glow that doubles as a directionless shadow) without per-shape shadow art. PO-003's `assets/pin-shadow.svg` and the `pins-shadow` layer are deleted as part of this work.

2. **Sprite ids are namespaced under `city-pin-map.icon.`.** OpenFreeMap Liberty's POI sprite atlas ships its own entries named `circle`, `star`, `flag`, `house`, etc. Registering pin-icons under bare names would race the basemap on every `styledata`. The fix is two-layered: (a) store short ids in `pin.shape` and the registry (`"star"`), (b) prefix at MapLibre registration time (`addImage("city-pin-map.icon.star", …)`) and at render-expression time (`["concat", "city-pin-map.icon.", ["get", "shape"]]`).

What this spec adds beyond the 2026-05-09 design:

- Larger starter set (~25 vs 6).
- User-add custom icons via file drop / textarea paste / URL field, persisted in `localStorage`.
- Hybrid color model: per-shape `tintable: bool` metadata. Tintable shapes (the entire starter set + monochrome user uploads) tint with the pin's color. Non-tintable shapes (full-color custom art) render as-is with a small color ring underneath for group-color visibility.
- Modal picker (richer surface for grid + categories + add-icon sub-flow + per-icon delete + attribution display) instead of a popover.
- Backup format bumps from v1 to v2 to include `userIcons`.

## Data model

### Pin schema (additive change)

```js
{
  id: string,
  name: string,
  lat: number,
  lon: number,
  color: string,
  group: string | null,
  shape: string | null,    // new — short id, defaults to "default-teardrop" when null
  createdAt: number
}
```

`shape` is **optional**. A pin without `shape` (older session, hand-edited storage, imported v1 backup) renders as `default-teardrop`. The render path materializes `pin.shape` into the GeoJSON feature's `properties.shape` via `effectiveShape(pin)` — parallel to `effectiveColor(pin)`. Unknown ids (typo, future-version backup, deleted user-icon) ALSO degrade to `default-teardrop`. Render must never crash on unknown values.

### User-icon entity (new)

```js
{
  id: string,                 // crypto.randomUUID()
  name: string,               // user-supplied
  tintable: boolean,          // true → registered as SDF, tinted by icon-color; false → registered RGBA, renders as-is
  fillSvg: string,            // sanitized SVG markup; monochrome (single fill color) when tintable
  attribution: {
    artistName: string | null,
    sourceUrl: string | null
  } | null,
  createdAt: number
}
```

No `category` field — all user icons live under "My icons" in the picker. No `shadowSvg` — yesterday's halo discovery means SDF shapes get their shadow + contour from paint properties, and non-tintable shapes typically ship with their own visual depth.

`localStorage` key: `city-pin-map.user-icons.v1`. Pub/sub mirrors `pins.js` and `groups.js`.

## Architecture

### New modules

```
+ js/shapes-builtin.js   # Static module: ~25 starter shapes as inline JS objects with embedded SVG strings
+ js/shapes.js           # Shape registry (builtins + userIcons), pub/sub, addImage orchestration
+ js/user-icons.js       # User-icon store: localStorage CRUD, pub/sub
+ js/shape-picker.js     # Modal: grid + search + categories + add-icon sub-flow + delete/credit display
+ js/svg-ingest.js       # Sanitize + normalize + derive SDF + tintable heuristic (pure, testable)
```

### Existing modules touched

```
~ js/map.js              # Image registry rebuild, two-layer render (color-ring + fill), halo paint, prefix
~ js/pin-list.js         # Per-row shape thumbnail trigger
~ js/pins.js             # Optional `shape: string | null` field in the pin model + persistence
~ js/app.js              # Hydrate userIcons$ before pins$ subscribers
~ js/backup.js           # Include userIcons in export, accept v1+v2 on import
~ css/styles.css         # Picker modal styles, thumbnail sizing
- assets/pin-fill.svg    # Becomes assets/shapes/default-teardrop.svg
- assets/pin-shadow.svg  # Deleted (halo paint replaces it)
+ assets/shapes/*.svg    # ~25 source files (also embedded as strings in shapes-builtin.js for offline-first)
```

### Module responsibilities

**`js/shapes-builtin.js`** — pure-data module. Exports an array of `{ id, name, category, tintable, fillSvg }` objects. SVG markup is embedded as JS template literals so the starter set registers synchronously without `fetch`. Categories: `pins`, `travel`, `places`, `transport`, `markers`. The default teardrop has its own ad-hoc category `default` (one entry, sits above all others in the picker UI).

Starter set composition target (~25 shapes; exact icon picks are the implementation plan's job, not the spec's):

| Category | Count | Notes |
|---|---|---|
| `default` | 1 | The default teardrop, ported from PO-003's `pin-fill.svg` and renamed `default-teardrop.svg`. |
| `pins` | 6 | Pin-silhouette variants: circle, square-rounded, hexagon, balloon, flag, star. |
| `travel` | 6 | Airplane, hotel, restaurant, coffee, camera, suitcase. |
| `places` | 5 | Home, building, mountain, tree, hospital. |
| `transport` | 4 | Car, bus, train, bike. |
| `markers` | 4 | Heart, checkmark, exclamation, question. |

Total: 26 shapes. All sourced from Lucide (MIT) or Tabler (MIT) — no attribution required, no Flaticon licensing surface in the starter set. All registered as `tintable: true` so the SDF + halo pipeline renders them uniformly.

**`js/shapes.js`** — registry merge. Subscribes to `userIcons$` and re-emits `shapes$` whenever the merged registry changes. Public API:

```js
shapes$.list()          // Array<Shape>
shapes$.get(id)         // Shape | undefined
shapes$.subscribe(fn)
effectiveShape(pin)     // returns a known shape id, falling back to "default-teardrop"
```

**`js/user-icons.js`** — same pub/sub shape as `pins.js`. CRUD: `add(icon)`, `remove(id)`, `replaceAll(arr)`, `list()`, `subscribe(fn)`. Hydrates from `localStorage` on import.

**`js/svg-ingest.js`** — pure function `ingestSvg(rawText, meta)`:

1. Parse via `DOMParser` with `image/svg+xml`. Reject if `parsererror`.
2. Walk tree; allowlist elements (`svg, g, path, circle, rect, polygon, polyline, ellipse, line, defs, clipPath, mask, linearGradient, radialGradient, stop`) and attributes (geometry + `fill, stroke, stroke-width, opacity, transform, viewBox, d, cx, cy, r, x, y, width, height, rx, ry, points, x1, y1, x2, y2, offset, stop-color, stop-opacity, gradientUnits, gradientTransform`). Reject siblings, foreign-namespace, scripts, event handlers, `xlink:href` starting with `javascript:`.
3. Normalize: ensure `viewBox` exists (derive from `width`/`height` or default to `0 0 24 24`). Set outer-element `width="64" height="64"`.
4. Tintable heuristic: count unique non-transparent fill colors across all paths. ≤1 → suggest `tintable: true`. ≥2 → suggest `false`. Returned alongside the sanitized SVG so the user can override.
5. Returns `{ sanitizedSvg, suggestedTintable }`. Caller (the add-icon sub-view) presents both interpretations as live previews.

**`js/shape-picker.js`** — modal renderer. Two views inside the same overlay: the **grid view** (categorized shape grid + search + footer attribution line) and the **add-icon sub-view** (file drop / textarea / URL inputs + live preview + tintable radio). Picking a shape immediately writes `pin.shape = id` and closes the modal — same as the color picker's auto-close behavior.

## Render pipeline

### Image registration

On `map.load` (initial) and on every `styledata` (post-style-swap), the pipeline:

1. Fetch the merged registry: `shapes$.list()`.
2. For each shape, build an `Image()` from its `fillSvg` data URL. Resolve all in parallel via `Promise.all`.
3. For each loaded image, call:
   ```js
   map.addImage("city-pin-map.icon." + shape.id, img, { sdf: shape.tintable, pixelRatio: 2 });
   ```
4. After all images register, add the two layers in order: `pins-color-ring` then `pins-fill`.

The starter set's SVGs are inline JS strings (no network), so step 2 for builtins is just `URL.createObjectURL(blob)` or a synchronous `data:image/svg+xml,…` URI. User-icon SVGs are also strings (in `localStorage`), same treatment. Net: no real fetch happens — `Image.decode()` is the only async work.

### Two layers

In z-order, bottom-up:

**`city-pin-map.pins-color-ring`** — circle layer. Visible only for non-tintable shapes.

```js
{
  id: "city-pin-map.pins-color-ring",
  type: "circle",
  source: PINS_SOURCE_ID,
  filter: ["==", ["get", "tintable"], false],
  paint: {
    "circle-color": ["get", "color"],
    "circle-radius": 6,
    "circle-translate": [0, -2],   // nudge above the icon's bottom anchor so the ring peeks out from the base
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.5,
  },
}
```

The ring is the group-color visibility contract for non-tintable shapes. Tintable shapes don't need it — their fill is already the group color.

**`city-pin-map.pins-fill`** — symbol layer. The marker layer for all shapes.

```js
{
  id: "city-pin-map.pins-fill",
  type: "symbol",
  source: PINS_SOURCE_ID,
  layout: {
    "icon-image": ["concat", "city-pin-map.icon.", ["get", "shape"]],
    "icon-anchor": "bottom",
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    "icon-size": 1.0,
  },
  paint: {
    "icon-color": ["get", "color"],
    "icon-opacity": 1,
    "icon-halo-color": "#ffffff",
    "icon-halo-width": 1.5,
    "icon-halo-blur": 2,
  },
}
```

`icon-color` and `icon-halo-*` are silently ignored on non-SDF sprites in the same layer — MapLibre's documented behavior. So tintable + non-tintable shapes coexist on this single layer: the SDF ones tint and get a halo; the non-SDF ones render in original colors with no halo. No filter split needed.

The drag listener stays on `city-pin-map.pins-fill` — the only change from PO-003 is the layer id (newly prefixed) and that the layer is the only marker layer (PO-003's `pins-shadow` companion is removed).

### Layer ordering with the labels layer (PO-002)

PO-002's pin-labels layer (added in concert with PO-003 — see PO-003's "Implementation note") sits above the pin marker layer so labels read clearly. Final z-order, bottom-up:

1. `city-pin-map.pins-color-ring` (circle, gated to non-tintable shapes)
2. `city-pin-map.pins-fill` (symbol, all shapes)
3. `city-pin-map.pin-labels` (symbol, unchanged from PO-002)

The labels layer is unchanged by this work. The route polyline (NICE-005's optional connecting line, header toggle) sits **below** all three pin layers, also unchanged.

### Materialization in the GeoJSON source

`pinsToFeatureCollection` (in `map.js`) materializes per-pin properties at build time:

```js
properties: {
  id: pin.id,
  name: pin.name,
  color: effectiveColor(pin),
  shape: effectiveShape(pin),                // clamped to known id; falls back to "default-teardrop"
  tintable: shapes$.get(effectiveShape(pin)).tintable,
}
```

Single source of truth: every change to pin/group/userIcon state results in one rebuild of the source, no per-feature post-update.

## Picker modal UX

### Pin-list integration

Each pin row in the side panel gains a small **shape thumbnail trigger** (24×24, rendered as `<img src="data:image/svg+xml;utf8,…">` direct from the registry's SVG string — no MapLibre involvement on the panel side). The thumbnail sits between the color swatch and the group selector. Click → opens the shape picker modal scoped to that pin.

### Modal — grid view

```
┌──────────────────────────────────────────────┐
│  Pin shape                              [×]  │
├──────────────────────────────────────────────┤
│  [🔍 Search shapes…                       ]  │
├──────────────────────────────────────────────┤
│  Default                                     │
│  [▼]  ← single tile, the default teardrop   │
│                                              │
│  Pins                                        │
│  [○] [□] [✦] [♥] [⚑] [☆] (~6 tiles)        │
│                                              │
│  Travel                                      │
│  [✈] [🏨] [🍴] [☕] [📷] (~5 tiles)         │
│                                              │
│  Places                                      │
│  [🏠] [🏢] [⛰] [🌳] (~4 tiles)              │
│                                              │
│  Transport                                   │
│  [🚗] [🚌] [🚆] (~3 tiles)                   │
│                                              │
│  Markers                                     │
│  [✓] [!] [?] (~3 tiles)                     │
│                                              │
│  My icons                              + Add │
│  [user1] [user2] …  [+ Add icon…]           │
├──────────────────────────────────────────────┤
│  Custom icons may include third-party        │
│  artwork. Hover an icon for credit.          │
└──────────────────────────────────────────────┘
```

- **Tile**: 56×56 with the SVG centered. Tintable shapes render in the pin's currently-active color so the user previews the result before clicking. Non-tintable shapes render in their original colors. Hover shows a tooltip with the shape name.
- **Selection state**: 2 px ring around the active tile. Picking immediately writes `pin.shape = id` and closes the modal.
- **Search**: filters across all categories by `name`; hides empty categories.
- **User-icon tiles**: hover shows a small trash icon (top-right). Hover-tooltip shows attribution: e.g. `"Pizza pin — by John Doe — flaticon.com/icon/123"` (or just the name if no attribution).
- **Footer line**: always present in the modal. Single sentence, low-key. Per Q8a-ii decision in brainstorming.

### Modal — add-icon sub-view

Slides in over the grid (same modal overlay, internal view swap):

```
┌──────────────────────────────────────────────┐
│  ← Back        Add custom icon         [×]  │
├──────────────────────────────────────────────┤
│  Name *                                      │
│  [Coffee shop                              ] │
│                                              │
│  SVG content *                               │
│  ┌────────────────────────────────────────┐ │
│  │ Drop SVG file here                     │ │
│  │                  or                    │ │
│  │ [Paste SVG markup                    ] │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  Source URL (optional, for credit)           │
│  [https://www.flaticon.com/free-icon/…    ] │
│  ⓘ Source link only — not downloaded         │
│                                              │
│  Artist name (optional)                      │
│  [Freepik                                  ] │
│                                              │
│  ─── Preview ─────────────────────────────── │
│  Tinted          As-is                       │
│  [tinted preview] [as-is preview]            │
│                                              │
│  Tinting:                                    │
│  ( ) Tint with pin color                     │
│  (●) Use as-is              (recommended)    │
│                                              │
│  [Cancel]              [Add to my icons]    │
└──────────────────────────────────────────────┘
```

- **Three input paths converge** on `ingestSvg(rawText, meta)`. File drop uses `FileReader.readAsText()`. Textarea takes value directly. URL field is **never fetched** — pure attribution metadata. The hint under the URL field makes that explicit.
- **Live preview**: two `<img>` tags from `data:image/svg+xml,…`. The "Tinted" preview applies the pin's currently-active color via inline CSS (`color: <hex>` on a parent + `currentColor` substitution on the SVG paths in the preview). The "As-is" preview shows the SVG unmodified.
- **Sanitization runs before preview is shown.** If the SVG fails (script tags, foreign elements), the preview area shows: "This SVG contains content that can't be safely imported. Try downloading from a different source." The Add button stays disabled.
- **Tintable radio default** comes from the `ingestSvg` heuristic (≤1 unique fill → "Tint with pin color", ≥2 → "Use as-is"). The "(recommended)" label sits next to whichever option the heuristic chose; switching the radio doesn't move the label. User can override either way.
- **"Add to my icons"**: writes to `userIcons$`, closes the sub-view, returns to the grid with the new icon highlighted and selected.

### Picker close behavior

- Pick a shape → write `pin.shape = id` → close modal. Same as color picker auto-close.
- ESC → close without writing.
- Click outside the modal → close without writing.
- Trash icon on a user-icon tile → confirm dialog → `userIcons$.remove(id)` cascades `pin.shape = null` for any pin currently using it (parallel to `group-panel.js` cascading `pin.group = null` on group delete). Affected pins re-render as the default teardrop.

## Edge cases & lifecycle

| Situation | Behavior |
|---|---|
| `pin.shape` references a deleted user icon | `effectiveShape` clamps to `"default-teardrop"`. No crash, no warning. |
| User-icon delete while pins reference it | `userIcons$.remove(id)` cascades `pin.shape = null` on all pins — same pattern as group cascade in `group-panel.js`. |
| Style swap (`setStyleSafely`) | `styledata` re-add path: re-register every shape in the registry under the prefixed sprite ids (`Promise.all` on image decode), then re-add both layers in order. The race-vs-error timeout from HARDEN-011 still wraps the swap. |
| User imports a backup with shape ids unknown to this device | Shape ids in the imported `userIcons` array come along with their SVG content, so they're known after import. Pin references resolve. Future format mismatches degrade to default. |
| Two devices' backups overlap on user-icon ids | Import strategy: replace-by-id (last writer wins). Pins keep their references because the id is preserved. |
| SVG import contains `<script>`, `<foreignObject>`, `xlink:href="javascript:…"`, or `on*` attributes | Sanitizer rejects with a user-visible error. Allowlist approach — only known-safe elements/attrs survive. |
| SVG import lacks `viewBox` | Sanitizer derives one from `width`/`height` attrs; if neither, defaults to `0 0 24 24`. |
| SVG import is huge | No app-level limit (Q8c-i). `localStorage` quota throws on the write that exceeds it; existing `showError()` banner surfaces "Couldn't save icon — storage is full." |
| User refreshes mid-add | Modal state is ephemeral, not persisted. Sub-view loses its draft. Acceptable. |
| Hydration order on app boot | `app.js` hydrates `userIcons$` before subscribing UI renderers, then explicitly backfills the renderer once. Same pattern CLAUDE.md calls out for pins/groups. |
| Sprite id collision with basemap atlas | Solved by the `city-pin-map.icon.` prefix at registration + render-expression time. The user-facing `pin.shape` value stays as the short id (`"star"`) for ergonomics and storage size. |

## Backup/restore (HARDEN-001 update)

- **Export shape**: `{ version: 2, pins, groups, userIcons }`. Version bumps from 1 → 2.
- **Import** accepts both v1 (no `userIcons` key) and v2. Backups touch only the keys they include — same pattern as API keys (which are also persisted in `localStorage` but excluded from backups). Concretely:
  - **v1 import** replaces pins + groups. The user-icon library on the importing device is **left untouched**. A pin in the imported set whose `shape` references a user icon that doesn't exist locally degrades to `default-teardrop` via `effectiveShape`.
  - **v2 import** replaces pins + groups + userIcons. Replace-by-id semantics: if a v2 backup includes a user icon whose id matches an existing local one, the import overwrites it (last writer wins).
- **API keys still excluded** (CLAUDE.md hard rule #3 — keys never travel in JSON exports).
- Per Q8b-ii in brainstorming, `userIcons` is always included in v2 exports; no opt-out checkbox in the export dialog.

## Acceptance criteria

- [ ] Pins with no `shape` field render exactly as PO-003 today (default teardrop, group color via tinting, drag, all unchanged).
- [ ] Each pin row in the side panel has a clickable shape thumbnail rendering the current shape in the pin's effective color.
- [ ] The shape picker modal opens, shows categorized starter shapes (Default + Pins + Travel + Places + Transport + Markers + My icons), supports search by name.
- [ ] Picking a tintable shape: pin tints with `effectiveColor()`; group color override still wins; halo (white inner contour + soft glow) is visible on every basemap.
- [ ] Picking a non-tintable shape: pin renders in original colors; a colored ring underneath shows group/pin color so the group-color contract stays visible.
- [ ] Adding a custom icon via file drop, textarea paste, or URL+file works. Sanitization rejects unsafe SVGs with a user-visible error and disables the Add button.
- [ ] The tintable radio defaults from the heuristic, and the user can override.
- [ ] Live preview in the add-icon sub-view shows both interpretations (tinted with current pin color, and as-is) before commit.
- [ ] Source URL field is never fetched; the hint text under it says so.
- [ ] Deleting a user icon cascade-clears `pin.shape` to null on every pin using it; those pins fall back to the default teardrop.
- [ ] JSON backup includes `userIcons`; import accepts both v1 (no userIcons) and v2.
- [ ] Style swaps preserve all shapes correctly across `styledata` re-adds (sprite registration is repeated, no flicker, no missing markers).
- [ ] Sprite ids are namespaced under `city-pin-map.icon.` and do not collide with basemap atlas entries (verified on OpenFreeMap Liberty's POI sprites for `circle`, `star`, `flag`, `house`).
- [ ] Drag wiring works on every shape (listener still on `city-pin-map.pins-fill`).
- [ ] PNG export captures the new shapes — automatic via `getCanvas()`.
- [ ] All previously completed tasks still pass; no console errors on any flow (initial load, basemap swap, pin add/edit/delete, group cascade, user-icon add/delete, backup export/import).

## Files affected

```
+ js/shapes-builtin.js                 # ~25 inline-SVG starter shapes, categorized
+ js/shapes.js                         # Registry merge (builtins + user) + pub/sub + effectiveShape
+ js/user-icons.js                     # User-icon store
+ js/svg-ingest.js                     # Sanitize + normalize + tintable heuristic
+ js/shape-picker.js                   # Modal: grid view + add-icon sub-view
+ assets/shapes/<id>.svg               # ~25 source SVGs (also embedded as strings in shapes-builtin.js)
~ js/map.js                            # Image registry rebuild loop, two-layer render, halo paint, sprite prefix
~ js/pin-list.js                       # Per-row shape thumbnail trigger
~ js/pins.js                           # Optional `shape: string | null` in pin model + persistence
~ js/app.js                            # Hydrate userIcons$ before pins$ subscribers
~ js/backup.js                         # Include userIcons in export, accept v1+v2 on import
~ css/styles.css                       # Picker modal styles, thumbnail sizing, color-ring anchor offset
- assets/pin-fill.svg                  # Becomes assets/shapes/default-teardrop.svg
- assets/pin-shadow.svg                # Deleted (halo paint replaces it)
~ CLAUDE.md                            # "What's shipped" entry for the shape library
~ docs/superpowers/specs/2026-05-09-pin-icon-picker-design.md  # Mark Superseded with pointer to this file
```

## Risks

| Risk | Mitigation |
|---|---|
| `icon-halo-*` rendering varies across browsers | MapLibre handles glyph rendering uniformly; verified in PO-003 across Chrome/Safari/Firefox via the previous shadow companion's rollout. |
| Bundle size with ~25 inline SVG starter shapes | Each SVG is ~1–2 KB; total ~30–50 KB embedded in `shapes-builtin.js`. Acceptable for a no-build local app. |
| `localStorage` quota for user icons (~5–10 MB origin limit) | Per Q8c-i, no app-level limit. Quota throws are surfaced through `showError()`. |
| Sanitizer rejects legitimate SVGs (false positives) | Allowlist is strict by design. If a user reports a broken import, we add the missing element/attribute to the allowlist; defer that until reported. |
| Sprite registration race during `styledata` swap | `Promise.all` on image decode before the layer add. The race-vs-error timeout from HARDEN-011 wraps the whole swap. |
| User pastes a malformed `<svg>` snippet (no outer element, multiple roots) | `DOMParser` returns a `parsererror`; caller surfaces "Couldn't read this SVG" in the preview area. |
| Pin labels (PO-002) sit at a fixed offset that doesn't suit all shape heights | Out of scope for this spec. Yesterday's spec parked it; same disposition. Revisit if a user notices. |
| User icons' `tintable: true` setting fights an SVG that has multiple fills | Heuristic suggests `false` for ≥2 fills; user can override but the visual result is whatever `addImage` does with a multi-fill SDF (typically: collapses to alpha, loses internal detail). User-visible — they can re-add as `tintable: false`. |

## Out of scope (parked)

- Per-icon category assignment for user icons (all live under "My icons").
- Editing existing user icons (delete + re-add).
- Shape per group (pins own `shape` individually).
- Search by tag/keyword across user icons (search filters by name only).
- "Reset all pins to default" bulk action.
- Importing icon packs from a URL or JSON manifest.
- Per-pin size override.
- Animations on shape change.
- Cluster/aggregation for many pins.
