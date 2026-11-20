# UXR-004: Deleting a pin or group (and Apply to all / New map) is instant, with no undo

| Field           | Value                                                    |
|-----------------|----------------------------------------------------------|
| **ID**          | `UXR-004`                                                |
| **Milestone**   | `UX review`                                              |
| **Status**      | `Done`                                                   |
| **Severity**    | `High`                                                   |
| **Priority**    | `High`                                                   |
| **Depends on**  | UXR-014 (toast action), UXR-021 (New map handles)        |

## Summary

Pin delete, group delete (with its un-grouping cascade), "Apply to all pins" and "New map" were irreversible. Each now shows a toast with an Undo action (about 9 s).

## Context

**Files:** `js/undo.js` (new), `js/undo.test.mjs` (new), `js/pins.js`, `js/groups.js`, `js/pin-list.js`, `js/group-panel.js`, `js/app.js`, `test/coverage/scenarios/40-box-select-and-inset.mjs`

## Failure scenario

The user clicks the always-visible x on a pin row by accident, or clicks "Apply to all pins", and loses the pin or their per-pin colours and icons with no way back.

## Fix direction

- `js/undo.js`: `offerUndo(message, restoreFn)` is single-level. A newer offer dismisses the older toast and invalidates its restore, so a stale Undo cannot apply.
- `restorePin(pin, index)` and `restoreGroup(group, index)` re-insert the verbatim object (same id, createdAt, labelDx/Dy) at the old list index, so list order and the createdAt route are identical. They are targeted, so other concurrent edits survive.
- Group delete: Undo restores the group, then re-assigns the captured member pins that still exist.
- Apply to all: the `confirm()` is removed. Undo restores each pin's previous icon and colour on the current pins only.
- New map: the confirm is kept. Pins, groups and the title/frame/fade/inset `getState()` values are captured and restored in place on Undo.

## Acceptance criteria

- [x] Each action shows an Undo toast. Evidence: Playwright smoke, all four flows.
- [x] Undo restores the exact previous state, including route order and label offsets. Evidence: deep-equal of the pin array after Undo in the smoke; `js/undo.test.mjs`.
- [x] Stale undo cannot apply after another destructive action. Evidence: `js/undo.test.mjs` "newer offer invalidates".
