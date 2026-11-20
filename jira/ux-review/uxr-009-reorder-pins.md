# UXR-009: Route order can't be changed

| Field           | Value        |
|-----------------|--------------|
| **ID**          | `UXR-009`    |
| **Milestone**   | `UX review`  |
| **Status**      | `Done`       |
| **Severity**    | `Medium`     |
| **Priority**    | `Medium`     |

## Summary

The pin list and the connecting route both follow `createdAt`, so trip users could not fix the order without deleting and re-adding pins (losing customizations).

## Context

**Files:** `js/pins.js`, `js/pin-list.js`, `js/tips.js`, `css/styles.css`, `js/pins.test.mjs`

- Route order: `renderRouteTo` in `js/map.js` sorts by `createdAt`; the list sorts the same way.

## Failure scenario

A user adds Paris, Rome, Berlin but wants Berlin first. There is no way to move it; the route keeps the add order.

## Fix direction

- New pure `reorderByCreatedAt(pins, movedId, newIndex)` in `js/pins.js`: reassigns the existing `createdAt` values (ascending, forced strictly increasing on ties) to the pins in their new visual order. No new pin field, backup format unchanged.
- Each pin row gets a row-start drag handle (⋮⋮ button) in `js/pin-list.js`: Pointer Events with capture, a blue drop-indicator on the target row, one `replaceAll()` batch on release. The click after a drag is suppressed so it does not fly the map; list rebuilds are held during a drag (like rename).
- Keyboard: Alt+ArrowUp/Down on the focused handle moves one place and restores focus.
- Tip added to `js/tips.js`.

## Acceptance criteria

- [x] Rows can be dragged and the route updates. *(Playwright smoke: dragging row 3 to the top gives Berlin, Paris, Rome; the route sorts by the reassigned `createdAt`. The route source itself was not read: the headless run has no basemap style.)*
- [x] Keyboard reorder works. *(Alt+ArrowDown/Up moved the row and kept focus on the handle.)*
- [x] The order persists across reload and backup round-trip. *(Reload kept the order; order is `createdAt`, which the backup already stores.)*
- [x] No new pin fields. *(Only existing `createdAt` values are reassigned.)*
- [x] Node tests pass. *(`js/pins.test.mjs`: 28/28, 4 new.)*

## Files affected

```
~ js/pins.js
~ js/pins.test.mjs
~ js/pin-list.js
~ js/tips.js
~ css/styles.css
+ jira/ux-review/uxr-009-reorder-pins.md
```
