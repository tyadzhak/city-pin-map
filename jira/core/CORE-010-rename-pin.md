# CORE-010: Rename a pin's label

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-010`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `CORE-008`                                  |

## Summary

Allow the user to rename any pin from the side-panel list. The new name updates the row, the map marker tooltip, and the persisted state. After this task, the user can override the geocoder's verbose display names with whatever they want printed on the map.

## Context

`PROJECT.md` → "Milestones → Core" explicitly notes that "the geocoder's output isn't always what you want printed" — Tokyo's Nominatim display name is `"Tokyo, Japan"` or `"東京都, 日本"` depending on settings, and the user might want it to read just `"Tokyo"`. Renaming is therefore a first-class Core feature, not polish.

This task uses `updatePin` from CORE-003. The pin store fans out the change to both the map (CORE-005) and the list (CORE-008), so the rename appears everywhere automatically.

## Acceptance criteria

- [x] Each pin list row exposes a way to enter rename mode (e.g. a small "Edit" button next to the delete control, or double-clicking the name text).
- [x] In rename mode, the row shows an input prefilled with the current name and the input is focused with text selected.
- [x] Pressing Enter or blurring the input commits the new name via `updatePin(id, { name })`.
- [x] Pressing Escape cancels rename mode and restores the original name.
- [x] An empty trimmed name is rejected — the rename is discarded and the original name remains. (The user-visible reason can be implicit; no error banner needed.)
- [x] After commit, the row text and the map marker tooltip both reflect the new name.
- [x] The new name persists across page reloads.
- [x] The rename control is keyboard-accessible (focusable, Enter/Space activates).
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/pin-list.js
~ css/styles.css
```

## Out of scope

- No multi-line names or rich formatting.
- No length limit beyond what the input naturally allows. (If the name is very long, the export image will look weird — fine for now, fixable visually later.)

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. PROJECT.md → "Milestones → Core" calls out renaming explicitly: the geocoder's labels are not always what you want printed.

Task: Let the user rename a pin from the pin list. The new name flows through the pin store to the map marker and to localStorage automatically.

Requirements:
- In js/pin-list.js, add a way to enter rename mode for a row. Pick one and stay consistent:
  - Approach A: a small "Edit" button next to the delete button.
  - Approach B: double-click the name text.
  - Approach C: both. (Probably overkill for Core.)
- In rename mode, replace the name text with an <input type="text"> prefilled with the current name. Call .focus() and .select() on the input immediately so typing replaces the existing text.
- Commit on:
  - Enter key — commit the trimmed value.
  - Blur — commit the trimmed value.
  - Empty trimmed value — discard, do not commit.
- Cancel on:
  - Escape key — exit rename mode without changing anything.
- Commit means `updatePin(pin.id, { name: trimmed })` from js/pins.js. The store's subscribers re-render the row and update the marker tooltip.
- Style the input to match the row's typography so the transition is not jarring.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Vanilla DOM. No frameworks, no input libraries.
- Avoid `innerHTML` with user input — set values via `.value` (input) and `.textContent` (text node).
- Do not call updatePin on every keystroke — only on commit.

Deliverables:
- Updated js/pin-list.js with rename behavior.
- Updated css/styles.css with input styles for rename mode.

Verification:
- Add a pin via search; trigger rename; type a new name; press Enter — the row text updates, hover the marker on the map and the tooltip shows the new name.
- Trigger rename; press Escape — original name preserved.
- Trigger rename; clear the input; press Enter — original name preserved (empty rejected).
- Rename a pin; refresh; the renamed value persists.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

If you go with the "Edit button" approach, make sure the button is also keyboard-reachable. Approach B (double-click) is harder to discover but cleaner visually — explicitly pick one and document it briefly in the row's `aria-label` or a tooltip.
