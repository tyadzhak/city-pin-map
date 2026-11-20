# FBL-027: Pin labels and box-select use unwrapped longitudes near the antimeridian

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-027`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

MapLibre (default `renderWorldCopies: true` on both the main map and the inset) draws the WebGL pin icon on the world copy nearest the viewport, but `map.project([pin.lon, pin.lat])` projects the raw longitude onto the primary copy. Near the antimeridian the two disagree by a full 360 degrees of screen width, so the pin's DOM label, its exported label, and its box-select hit-test all land far off-screen while the icon is visible.

## Context

**Files:** `js/map-labels.js`, `js/map-select.js`

- `js/map-labels.js` `computeLabelSpecs` — projected with raw `pin.lon`. Also the single source of truth for `js/export.js`'s `paintPinLabels` and the inset's labels, so those were wrong too.
- `js/map-labels.js` label-drag `onPointerMove` — same raw projection; `labelDx`/`labelDy` are offsets from the projected anchor, so drag must use the same anchor as rendering.
- `js/map-select.js` `onContainerPointerUp` — builds the points handed to `pinsInRect` with raw `project()`.
- No `renderWorldCopies` override exists anywhere in `js/` (grep), so world copies are on for both maps and the helper's behavior matches what MapLibre renders.
- No other pin-projection sites: `js/export.js` has no `project()` call (it goes through `computeLabelSpecs`), `js/map-inset.js` has none, and `js/map-title.js` anchors by container fraction (`nx`/`ny`), not lon/lat.

## Failure scenario

Map centered at lng 150 with a pin in Samoa (lng -172). The icon renders at the 188 degree copy, on screen. Its label sits at x of roughly -1200 px: no label on screen, none in the exported PNG. Shift-dragging a box around the visible icon reports zero pins.

## Fix direction

Wrap each pin's longitude toward the target map's current center before projecting (`lon + 360k` so `|lon - center.lng| <= 180`), the same idea as MapLibre Marker's `smartWrap`, via one pure helper used at every projection site.

## Acceptance criteria

- [x] With the map centered across the antimeridian from a pin, the pin's DOM label is positioned on the same world copy as its icon. *(Runtime-only to fully confirm; by construction `computeLabelSpecs` now projects via `projectNearCenter`.)*
- [x] The exported PNG and the inset include the label (both consume `computeLabelSpecs`). *(Runtime-only; by construction, no separate projection exists in `export.js`/`map-inset.js`.)*
- [x] Label dragging near the antimeridian keeps the label under the cursor and stores the same `labelDx`/`labelDy` semantics. *(Runtime-only; `onPointerMove` uses the same wrapped anchor as `computeLabelSpecs`.)*
- [x] Shift-drag box-select around a wrapped icon selects it. *(Runtime-only; `onContainerPointerUp` projects via `projectNearCenter`.)*
- [x] The wrapping helper is pure and unit-tested: near-center, both antimeridian crossings, multiples of 360, center at exactly +/-180, non-finite input. *(`js/geo-wrap.test.mjs`, 9 cases.)*
- [x] `node --check` passes on all changed modules, and `node --test js/*.test.mjs` passes.
- [ ] No errors in the browser console. *(Runtime-only; requires loading the app in a browser.)*

## Files affected

```
+ js/geo-wrap.js
+ js/geo-wrap.test.mjs
~ js/map-labels.js
~ js/map-select.js
+ jira/fable_findings/finding-027-antimeridian-unwrapped-projection.md
```

## Notes

The helper lives in a new dependency-free `js/geo-wrap.js` rather than in `map-select.js`'s pure section: `map-labels.js` would otherwise import an unrelated overlay module (and `map-labels.js` itself pulls in `map.js`, which is not node-importable), while a standalone module is importable by both with no DOM. `pinsInRect`'s contract is unchanged (it still takes caller-projected points). Known limit: at very low zooms where several world copies are on screen at once, a pin is labelled/hit-tested only on the copy nearest the center, like `Marker` smartWrap. The inset's fit-bounds for a group that itself straddles the antimeridian is a separate, unaddressed concern.
