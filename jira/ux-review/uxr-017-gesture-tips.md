# UXR-017: Hidden gestures aren't explained anywhere

| Field           | Value        |
|-----------------|--------------|
| **ID**          | `UXR-017`    |
| **Milestone**   | `UX review`  |
| **Status**      | `Done`       |
| **Severity**    | `Medium`     |
| **Priority**    | `Medium`     |

## Summary

Shift+drag box-select, dragging pin labels, dragging the on-map title and dragging the inset have no visible affordance, so new users never find them.

## Context

**Files:** `index.html`, `css/styles.css`, `js/tips.js` (new), `js/storage.js`, `js/storage.test.mjs`, `js/map-title.js`, `js/map-inset.js`

## Failure scenario

A user adds pins, sees overlapping labels or wants several pins in a group, and has no hint that labels, the title and the inset can be dragged or that Shift+drag selects pins.

## Fix direction

- Collapsible `<details id="pin-tips">` at the bottom of the Pins tab, open by default; its `<ul>` is filled from one `TIPS` array in new `js/tips.js` (loaded by a module script next to the markup, so `app.js` is untouched). Only gestures present on main are listed (box-select, label drag, title/inset drag, list rename by double-click).
- Open/closed state persisted via `loadTipsOpen`/`saveTipsOpen` (`city-pin-map.tips-open.v1`, try/catch, defaults open).
- `title="Drag to move"` on the on-map title overlay and the inset box.

## Acceptance criteria

- [x] Tips visible to a new user, collapsible, state remembered. Evidence: default open, `toggle` persists; node tests for load/save.
- [x] Overlay tooltips present. Evidence: `title` set in `map-title.js` and `map-inset.js`.
