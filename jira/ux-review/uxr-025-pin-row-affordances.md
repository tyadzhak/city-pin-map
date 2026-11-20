# UXR-025: Pin rename/delete only appear on hover; no double-click rename

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-025`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Low`                                       |
| **Priority**    | `Low`                                       |

## Summary

The pin list's rename (pencil) and delete buttons were fully transparent until the row was hovered, so they were undiscoverable, and the only way to rename was the pencil.

## Context

**Files:** `js/pin-list.js`, `css/styles.css`

- `.edit-pin` / `.remove-pin` had `opacity: 0` with a hover/focus-visible reveal.
- `enterRenameMode()` already owns Enter/Escape/blur semantics and the FBL-021 `renameActive` deferral.

## Failure scenario

A user looking at the Pins tab sees no way to rename or delete a pin until they happen to hover a row, and double-clicking the name does nothing.

## Fix direction

- Buttons now rest at `opacity: 0.45` and go to full opacity on row `:hover`, row `:focus-within`, and button `:focus-visible`.
- Double-clicking the pin name calls the same `enterRenameMode()`, guarded by `renameActive`; the name has `title="Double-click to rename"`.

## Acceptance criteria

- [x] Buttons are discoverable without hovering. *(Resting opacity 0.45 in `css/styles.css`.)*
- [x] Double-click rename works with unchanged Enter/Escape/blur semantics. *(Reuses `enterRenameMode`; FBL-021 deferral intact via the `renameActive` guard.)*
- [x] `node --check` and `node --test` pass.

## Files affected

```
~ js/pin-list.js
~ css/styles.css
+ jira/ux-review/uxr-025-pin-row-affordances.md
```
