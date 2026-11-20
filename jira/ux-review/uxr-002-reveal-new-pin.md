# UXR-002: Adding a city doesn't move the map to it

| Field           | Value              |
|-----------------|--------------------|
| **ID**          | `UXR-002`          |
| **Milestone**   | `UX review`        |
| **Status**      | `Done`             |
| **Severity**    | `High`             |
| **Depends on**  | UXR-003            |

## Summary

Selecting a search result added the pin and cleared the input, but the camera never moved, so an off-screen city (Tokyo while viewing Europe) was added invisibly. A file import likewise left pins wherever they fell.

## Context

**Files:** `js/search.js`, `js/import-foreign.js`, `js/map.js`, `js/map-labels.js`, `js/app.js`, `css/styles.css`

## Failure scenario

The user types "Tokyo" while looking at Europe, picks the result, and nothing visible happens; they cannot tell the pin was added.

## Fix direction

- `js/map.js`: new `revealPin(pin)`. If the projected pin is inside the viewport (48px margin) the camera stays put; otherwise `easeTo` the pin at the current zoom (a pan always keeps it in view, so no zoom-out is needed). `prefers-reduced-motion` jumps instead.
- `js/map-labels.js`: new `pulsePin(pinId)` keeps a short-lived pulse record at module scope so any label re-render re-applies the `--new` class; CSS pulse (box-shadow/background only, since position is an inline transform). Reduced motion gets a static outline instead.
- `js/search.js` and `js/import-foreign.js` stay map-free: they expose `setOnPinAdded` / `setOnImportComplete` hooks (guarded with try/catch), wired in `js/app.js`. Import completion fits all pins once via `fitToPins` (non-animated under reduced motion) when at least one pin was added.

## Acceptance criteria

- [x] Adding an off-screen city brings it into view smoothly. *(`revealPin` eases to the pin.)*
- [x] Adding an on-screen city doesn't move the camera. *(in-view early return.)*
- [x] The new pin is briefly highlighted. *(`pulsePin` + `.map-pin-labels__label--new`.)*
- [x] A file import ends with all pins in view. *(`setOnImportComplete` -> `fitToPins`.)*
- [x] Reduced motion is respected. *(jump + static outline.)*
- [x] `node --check` on changed modules and `node --test js/*.test.mjs`. *(440 pass, 0 fail.)*

## Files affected

```
~ js/search.js
~ js/import-foreign.js
~ js/map.js
~ js/map-labels.js
~ js/app.js
~ css/styles.css
+ jira/ux-review/uxr-002-reveal-new-pin.md
```
