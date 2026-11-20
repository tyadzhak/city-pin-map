# UXR-027: A dragged label can't be put back

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-027`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Low`                                       |
| **Priority**    | `Low`                                       |

## Summary

Dragging a pin label stores `labelDx`/`labelDy`, and nothing reset them. Double-clicking a label (main map or inset) now clears the manual offset so it returns to auto placement.

## Context

**Files:** `js/map-labels.js`, `js/tips.js`

- `computeLabelSpecs` treats `labelDx === 0 && labelDy === 0` as "not manual" (`_manual`), so UXR-019 auto placement takes over again. Fields are set to 0 (not deleted) via `updatePin`, which keeps the "absent means 0" contract.
- UXR-007 made a sub-4px press a click that dispatches `city-pin-map:pin-selected`.

## Failure scenario

A user nudges a label somewhere bad and can only drag it back by eye; it never returns to the auto-placed spot.

## Fix direction

- In `onPointerUp`, a click on the same pin within 500 ms of a previous click is treated as the second half of a double-click: the offset is reset and no second selection event fires. The first click selects (accepted behavior), the second resets. Detection is done on pointer events because the first click's `render()` replaces the label node, and `pointerdown.preventDefault()` suppresses compat mouse events, making native `dblclick` unreliable.
- A delegated `dblclick` listener on the label container stops propagation/default so the map never double-click zooms.
- Interactive labels (main + inset) get the tooltip "Drag to move · double-click to reset".
- Tip appended to `TIPS` in `js/tips.js`.

## Acceptance criteria

- [x] Double-click resets on both maps without zooming. *(Playwright smoke: main label 40,30 -> 0,0; inset 40 -> 0,0; zoom 2 before and after.)*
- [x] Single click still selects the pin, once. *(Smoke: one `pin-selected` per click; one for a double-click.)*
- [x] Tooltip present. *(Smoke: `title` attribute on the label.)*
- [x] `node --check` and `node --test js/*.test.mjs` pass.
