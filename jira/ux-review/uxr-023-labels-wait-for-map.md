# UXR-023: For about 1 s after reload, labels appear before the pin dots

| Field           | Value                |
|-----------------|----------------------|
| **ID**          | `UXR-023`            |
| **Milestone**   | `UX review`          |
| **Status**      | `Done`               |
| **Severity**    | `Low`                |
| **Priority**    | `Low`                |

## Summary

The DOM pin-label overlay rendered immediately at boot, while the WebGL pin layer only appears after the style and sprites load, so city names floated on a blank map with no dots (the inset showed the same in an empty box).

## Context

**Files:** `js/map-labels.js`, `css/styles.css`

- `createOverlay()` in `js/map-labels.js` is the single factory for the main map overlay and the inset overlay.
- `.map-pin-labels` rules in `css/styles.css`.

## Failure scenario

Reload the page with saved pins: for the first moments the labels are visible but the dots are not.

## Fix direction

Each overlay container starts at `opacity: 0` (no layout change) and gets `.map-pin-labels--ready` (150 ms fade-in) on the first map `render` event once the pins layer (`city-pin-map.pins-fill`) exists. A 4 s fallback timer reveals it anyway so a failed style load never hides labels permanently. Applied in `createOverlay`, so both main map and inset are covered; `computeLabelSpecs`/`paintPinLabels` and `pulsePin` are untouched (a pulse on a hidden overlay just renders into the invisible container and shows once revealed). Listener and timer are cleaned up in `destroy()`.

## Acceptance criteria

- [x] No floating labels without dots on reload. *(Playwright smoke: at ~150 ms and ~1500 ms the overlay had opacity 0 while the style was still loading.)*
- [x] Labels fade in with the pins. *(Both main and inset overlays reached opacity 1 later; screenshot shows dots and labels together.)*
- [x] The export is unchanged. *(Export reads `computeLabelSpecs`, not the DOM overlay; no change there.)*
- [x] `node --check` and `node --test js/*.test.mjs` pass. *(441 pass, 0 fail.)*
