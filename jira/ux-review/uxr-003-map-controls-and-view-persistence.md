# UXR-003: No "Fit all pins", no zoom buttons, map position resets on reload

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-003`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `High`                                      |
| **Priority**    | `High`                                      |
| **Depends on**  | None                                        |

## Summary

The map had no zoom buttons, no way to frame all pins, and always booted at world view (center `[0,20]`, zoom 2), so poster framing was lost on every reload.

## Context

**Files:** `js/map.js`, `js/storage.js`, `js/storage.test.mjs`, `css/styles.css`

- `initMap` hard-coded the camera and added no controls.
- `js/export.js` `captureFramed` reparents and resizes `#map`; `map.resize()` emits `moveend`, which a naive persistence hook would save.

## Failure scenario

The user frames a poster, reloads, and is back at the world overview. To see all pins they must pan and scroll-zoom by hand; there is no on-screen zoom control.

## Fix direction

- `initMap` adds MapLibre `NavigationControl` (zoom only, no compass) plus a custom `FitPinsControl` IControl in the top-left group (top-right/bottom-right are the inset's docking corners; raised above overlays via CSS; DOM controls never reach the export canvas).
- New exports `fitToPins(pins = listPins(), { animate = true })` and `flyToPin(pin, opts)` in `js/map.js` (JSDoc'd). Fit padding = 40px + outermost enabled frame (`margin + thickness + padding`, via `getFrameSetInUse()`), plus the bottom-fade height (% of map height) at the bottom; each axis capped at 40% of the canvas. Zero pins is a no-op.
- Camera persisted on debounced `moveend` to `city-pin-map.view.v1` as `{center, zoom, bearing, pitch}`; restored in `initMap`. `normalizeMapView`/`loadMapView`/`saveMapView` in `js/storage.js` (finite checks, clamps, lon wrap, corrupt stash; load returns `null` so `initMap` falls back to `[0,20]`/2). Kept out of the JSON backup.
- Export guard: the save runs at timer-fire time and is skipped when `#map`'s parent is not `.app-map` (the same test `map-viewport.js` uses), so export's off-screen resize never overwrites the saved view. No `export.js` edit needed.

## Acceptance criteria

- [x] Zoom buttons are visible. *(NavigationControl top-left.)*
- [x] "Fit all pins" frames every pin clear of frame and fade. *(`computeFitPadding`.)*
- [x] Reload restores the last view. *(`loadMapView` in `initMap`.)*
- [x] Export does not clobber the saved view. *(reparent guard in `scheduleViewSave`.)*
- [x] `fitToPins` and `flyToPin` are exported. *(`js/map.js`.)*
- [x] Tests pass. *(3 new `storage.test.mjs` cases; full `js/*.test.mjs` run: 429 pass, 0 fail.)*
