# UXR-026: Groups list shows no pin counts, and "Add group" doesn't focus the name

| Field           | Value                 |
|-----------------|-----------------------|
| **ID**          | `UXR-026`             |
| **Milestone**   | `UX review`           |
| **Status**      | `Done`                |
| **Severity**    | `Low`                 |
| **Priority**    | `Low`                 |

## Summary

"Add group" created "Group N" without focusing its name, and group rows gave no sense of how many pins each held (or would be ungrouped on delete).

## Context

**Files:** `js/group-panel.js`, `js/groups.js`, `js/groups.test.mjs`, `css/styles.css`

## Failure scenario

The user clicks "Add group", must click into the new row to rename it, and deletes a group without knowing it will ungroup several pins.

## Fix direction

- After "Add group", the new row's name input is focused and selected.
- Each row shows a pin count ("3 pins" / "1 pin" / "No pins") via new `formatPinCount()` in `js/groups.js`.
- The delete button's label and tooltip read "Delete group “Italy” (3 pins will be ungrouped)".
- `initGroupPanel` subscribes to the pin store and patches the count text and delete label IN PLACE (no row rebuild), so a name edit in progress is never clobbered.

## Acceptance criteria

- [x] The new group's name is ready to type. *(focus + select after the synchronous render.)*
- [x] Counts are accurate and live. *(computed per row on render; pin-store subscription refreshes them.)*
- [x] An in-progress name edit is never clobbered. *(pin changes never rebuild rows.)*
- [x] `node --check` and `node --test js/*.test.mjs` pass. *(new `formatPinCount` test.)*
