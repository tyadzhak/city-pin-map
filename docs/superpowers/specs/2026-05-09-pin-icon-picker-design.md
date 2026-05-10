# Pin icon picker — design

**Status:** Superseded by [`2026-05-10-pin-shape-library-design.md`](./2026-05-10-pin-shape-library-design.md)
**Date:** 2026-05-09
**Predecessor:** PO-003 (drop-pin markers)
**Successor:** 2026-05-10 pin shape library design

> **Superseded.** Approved 2026-05-09 but no implementation plan was written before the 2026-05-10 brainstorm widened scope (custom user-uploadable icons, hybrid tintable/non-tintable color model, modal picker, larger starter set, backup-with-userIcons). Two ideas from this spec carry forward unchanged into the successor: (1) `icon-halo-*` paint replacing the shadow companion, (2) the `city-pin-map.icon.` sprite-id prefix to avoid basemap atlas collisions.

## Goal

Let the user pick a marker shape per pin from a small curated set. Builds on PO-003's symbol-layer marker pipeline; reuses the SDF tinting contract so per-pin and per-group colors keep flowing through unchanged. Output (the printable PNG) is the product, so the icon set is curated for poster aesthetics rather than POI taxonomy completeness.

## Non-goals

- Per-icon color (each icon is a tintable single-color silhouette, no multi-color iconography).
- Custom icon upload. Out of scope; reopen if a user asks for it.
- Per-icon size. Every icon renders at the same on-screen size to keep the legend readable.
- Animations on icon swap.

## Icon set

Five SVGs sourced from [Heroicons](https://github.com/tailwindlabs/heroicons) (`solid` weight 24-grid, MIT license, by the Tailwind team) plus one hand-authored `circle.svg` matched to the Heroicons grid. Heroicons replaced an initial Phosphor draft after a quality pass — Heroicons' tighter 24-grid solid set reads cleaner at small map-marker sizes than Phosphor's chubbier 256-grid `fill` weight. Single coherent visual style, downloaded once into the repo — no runtime CDN dependency, no build step.

| Icon id    | Source                       | Use case                                   |
|------------|------------------------------|--------------------------------------------|
| `map-pin`  | Heroicons `24/solid/map-pin` | Default. Familiar drop-pin marker.         |
| `circle`   | Hand-authored                | Geometric neutral. "Visited, no semantic." |
| `star`     | Heroicons `24/solid/star`    | Favorite. Print-poster pride.              |
| `heart`    | Heroicons `24/solid/heart`   | Loved place. Gift-map use case.            |
| `flag`     | Heroicons `24/solid/flag`    | Milestone / "been there".                  |
| `house`    | Heroicons `24/solid/home`    | Home anchor on a personal poster.          |

Six fits a 2×3 popover grid and is small enough to scan instantly. Aesthetic mix is geometric-leaning with three expressive icons (star, heart, flag) for emotional flair — the use cases listed in `PROJECT.md`. Every icon is a filled silhouette so the SDF alpha-channel tinting from PO-003 just works. The Heroicons SVGs ship with `fill="currentColor"` on the root `<svg>`, which is exactly what we want: standalone rasterization (via `Image()` for MapLibre's image registry) defaults `currentColor` to black — perfect for the SDF alpha mask — and inline DOM rendering (the picker tile preview) inherits the wrapper element's CSS `color` for live tinting.

Files live at `assets/icons/<icon-id>.svg`. Each file gets a 5-line header comment with the upstream URL and MIT attribution.

**Rasterization size:** each SVG sets `width="128" height="128"` on the outer `<svg>` element while keeping Heroicons' native `viewBox="0 0 24 24"`. With `addImage`'s `pixelRatio: 4`, MapLibre treats the 128×128 raster as a 32×32 CSS-pixel image — the on-screen marker size (matching PO-003's drop-pin footprint), and what the SDF auto-generator works from. The high source-to-display ratio is what makes the SDF curves sample smoothly at small display sizes; an earlier draft used a 64×64 source which showed visible stairstepping along curved edges. Anyone reviewing this in the future and tempted to bump `pixelRatio` lower (which would *enlarge* the on-screen marker) should leave the source size alone and only change `pixelRatio`, so the SDF input stays high-resolution.

## SDF + halo (replaces shadow companion)

PO-003 used a two-image stack: a non-SDF `pin-shadow.svg` for the soft drop-shadow + white inner contour, beneath the SDF `pin-fill.svg` tinted by the pin's color. That stack scales linearly with the icon set — six icons would mean twelve SVG files, twelve hand-tunings, twelve chances for shape misalignment.

The fix: drop the shadow companion entirely. MapLibre's symbol layer paint properties give us a programmatic halo around any SDF icon:

- `icon-halo-color: "#ffffff"` — white halo, gives the inner contour cue.
- `icon-halo-width: 1.5` — pixel width of the halo band, matches PO-003's halo footprint.
- `icon-halo-blur: 2` — soft glow that doubles as a shadow without committing to a lighting direction.

Same visual register as PO-003. One SVG per icon. Every icon shape — drop-pin, star, heart, anything — gets the halo automatically.

`assets/pin-fill.svg` and `assets/pin-shadow.svg` are deleted as part of this work. The `pins-shadow` layer is removed; only the `pins-fill` layer remains for marker rendering.

## Data model

Pin schema gains one optional field:

```js
{
  id: string,
  name: string,
  lat: number,
  lon: number,
  color: string,
  group: string | null,
  icon: string | undefined,   // new — defaults to "map-pin" when missing
  createdAt: number
}
```

Invariant: `icon` is *optional*. A pin without `icon` (older session, hand-edited storage, imported legacy backup) renders as `map-pin`. The render path materializes this into the GeoJSON feature's `properties.icon` field at `pinsToFeatureCollection` time, mirroring how `effectiveColor()` materializes `properties.color` — a single pin-store change tick replaces the painted icon without a re-render bounce.

Unknown icon ids (typo, future-version backup) ALSO degrade to `map-pin` — the materialization function clamps to known ids before emission. Render must never crash on unknown values.

## Map module changes (`js/map.js`)

```diff
- const PIN_FILL_IMAGE_ID = "pin-fill";
- const PIN_SHADOW_IMAGE_ID = "pin-shadow";
- const PINS_SHADOW_LAYER_ID = "city-pin-map.pins-shadow";

+ const PIN_ICONS = [
+   { id: "map-pin", src: "assets/icons/map-pin.svg" },
+   { id: "circle",  src: "assets/icons/circle.svg" },
+   { id: "star",    src: "assets/icons/star.svg" },
+   { id: "heart",   src: "assets/icons/heart.svg" },
+   { id: "flag",    src: "assets/icons/flag.svg" },
+   { id: "house",   src: "assets/icons/house.svg" },
+ ];
+ const PIN_ICON_IDS = new Set(PIN_ICONS.map((i) => i.id));
+ const DEFAULT_PIN_ICON = "map-pin";
```

Image loading switches from a hardcoded fill+shadow Promise.all to a loop over `PIN_ICONS`. Each loaded `HTMLImageElement` is cached at module scope keyed by icon id. On every `addPinAndRouteLayers` call (initial load + every styledata after a basemap swap), the loop re-registers each as `sdf: true, pixelRatio: 2`.

The fill layer's `icon-image` becomes data-driven:

```js
layout: {
  "icon-image": [
    "coalesce",
    ["get", "icon"],
    DEFAULT_PIN_ICON,
  ],
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
```

The shadow layer is removed. The fill layer is the only marker layer.

`pinsToFeatureCollection` materializes the icon:

```js
properties: {
  id: pin.id,
  name: pin.name,
  color: effectiveColor(pin),
  icon: effectiveIcon(pin),
}
```

`effectiveIcon(pin)` returns `pin.icon` if it's in `PIN_ICON_IDS`, otherwise `DEFAULT_PIN_ICON`. Exported alongside `effectiveColor` for use by the UI tile preview.

`PIN_ICONS` is also exported for the picker's icon-grid render.

## UI: appearance tile + popover

The pin-list row's color swatch is replaced by a single button — the **appearance tile** — that renders the chosen icon at the chosen color. It IS the pin's preview as it appears on the map, doubling as both display and edit affordance.

Clicking the tile opens a popover floating below it containing:

```
┌─────────────────────────────────┐
│  [📍] [●] [★]                    │   ← icon grid (2x3)
│  [♥] [⚐] [🏠]                    │
│  ─────────────                  │
│  Color: [native color input]    │
└─────────────────────────────────┘
```

The icon grid: each cell is a button rendering its icon tinted in the pin's current color, so the user sees the result in advance of clicking. The selected icon has a visible "selected" state (border or background tint).

Color: native HTML5 `<input type="color">` — same affordance as today, just nested in the popover instead of inline. One extra click for the most-edited property; the tradeoff is justified by the pin-list row staying narrow.

Popover dismissal:
- Click outside the popover → close
- Escape key → close
- Picking an icon does NOT auto-close (lets the user iterate icon and color in one session)

Persistence:
- Picking an icon → `updatePin(pinId, { icon: nextIconId })`
- Changing color → `updatePin(pinId, { color: nextHex })` (unchanged from today)

The render order in the row becomes:
```
[appearance-tile] [name] [group ▾] [✎] [✕]
```

Same width as today (the tile is the same size as the color swatch was).

## Backwards compatibility

| Surface             | Old → new behavior                                                                 |
|---------------------|------------------------------------------------------------------------------------|
| Existing pins       | `icon` field absent → renders as `map-pin`. Looks identical to PO-003 today.       |
| `localStorage` pins | Round-trips fine; `icon` written when set, omitted when null/missing.              |
| JSON export         | Pin entries include `icon` if set; absent otherwise. Schema is forward-compatible. |
| JSON import         | Pins without `icon` import cleanly and render as `map-pin`.                        |
| Group color cascade | Unchanged — `effectiveColor()` is the single source of truth for tint.             |
| Drag / hover wiring | Unchanged — listens on `PINS_LAYER_ID` (the fill layer), still the only pin layer. |
| PNG export          | Unchanged — canvas-merge pipeline reads `mapInstance.getCanvas()` regardless.      |

No migration script needed.

## File changes

```
+ docs/superpowers/specs/2026-05-09-pin-icon-picker-design.md   (this file)
+ assets/icons/map-pin.svg
+ assets/icons/circle.svg
+ assets/icons/star.svg
+ assets/icons/heart.svg
+ assets/icons/flag.svg
+ assets/icons/house.svg
- assets/pin-fill.svg
- assets/pin-shadow.svg
~ js/map.js              (icon registry + halo paint + data-driven icon-image)
~ js/pin-list.js         (appearance tile + popover)
~ css/styles.css         (popover styles)
```

`js/pins.js` and `js/backup.js` need no code changes — the schema is additive and the round-trip path is value-preserving.

## Risks

| Risk                                                          | Mitigation                                                                       |
|---------------------------------------------------------------|----------------------------------------------------------------------------------|
| Phosphor's drop-pin tip isn't exactly at canvas-bottom-center | Hand-tune `assets/icons/map-pin.svg` to align tip with canvas-bottom edge if needed; other icons accept native Phosphor positioning. |
| Halo + icon-color render quality differs by browser           | MapLibre handles glyph rendering uniformly; verified in PO-003 across Chrome/Safari/Firefox. |
| Popover focus-trap or click-outside leaks                     | Use `pointerdown` capture-phase listener on `document`, scoped lifetime to "popover open" state. |
| User adds many pins, popover renders 6× icon previews each    | Tile is one icon (current), grid is 6 icons (only on open). Negligible at this scale. |
| Icon name collisions with basemap sprite atlas                | OpenFreeMap's Liberty style ships its own `circle`/`star`/`heart`/`flag`/`house`/`map-pin` sprites for POI markers. A bare `addImage("star", …)` either silently no-ops behind a `hasImage` guard or fights the basemap's version through stylechange races. Mitigation: every pin-icon image registers under the `city-pin-map.icon.` prefix; the layer's `icon-image` expression `concat`s the prefix at evaluation time, while `pin.icon` in storage stays the short public id. |

## Out of scope (parked)

- **Icon-aware label offset.** Currently labels sit `[0, 1.0]` em below the icon, sized for a drop-pin. House and flag have different visual heights; labels may overlap. Defer; revisit if a user notices.
- **Per-pin size override.** No request, no need.
- **Importing icon sets at runtime.** Phosphor is enough for v1.
