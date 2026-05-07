# CORE-009: Remove a pin from the list

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-009`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `CORE-008`                                  |

## Summary

Add a delete control to each row in the pin list. Clicking it removes the pin from the store, which automatically removes the marker from the map and the row from the list (both already subscribed to the store).

## Context

The pin list panel from CORE-008 currently displays pins but is read-only. This task adds the simplest interaction: a delete button per row. The pin store's `removePin` from CORE-003 does all the actual work; the UI just calls it.

`PROJECT.md` → "Milestones → Core" calls for "edit and delete" on the list — this task delivers the delete half.

## Acceptance criteria

- [x] Each pin list row has a visible delete control (e.g. a button labeled "✕" or "Delete") with an accessible label like "Remove pin {name}".
- [x] Clicking the delete control removes the pin from both the list and the map within one frame.
- [x] The removal persists — refreshing the page does not bring the pin back.
- [x] The delete control is keyboard-accessible: focusable via Tab, activatable via Enter or Space.
- [x] Removing every pin reveals the empty-state message from CORE-008.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/pin-list.js
~ css/styles.css
```

## Out of scope

- No undo. If desired, that's a v2 polish item.
- No bulk-delete or "clear all". Single-row delete is enough for Core.
- No confirmation dialog. Personal-use app, single user; the click is the confirmation. (If you disagree, document and pick one — don't half-implement.)

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Note PROJECT.md → "Milestones → Core" — "edit and delete" on the pin list. This task is the delete half.

Task: Add a delete button to every row in the pin list (rendered by js/pin-list.js) that removes the pin via the pin store.

Requirements:
- In js/pin-list.js, when rendering each row, append a <button class="remove-pin" type="button"> element. Set its text content to a clear glyph or short label (e.g. "✕"), and set `aria-label` to a descriptive string such as `Remove pin ${pin.name}`.
- Attach a click handler that calls `removePin(pin.id)` from js/pins.js.
- The button must be keyboard-activatable by default (a real <button> element handles Enter/Space natively — do not use a <div>).
- In css/styles.css, style the button: small, unobtrusive, visible on hover and focus, with a clear focus ring for keyboard users.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Vanilla DOM. Use `document.createElement('button')` and `addEventListener('click', ...)`.
- Do not add a confirm() dialog — keep the interaction snappy. A misclick can be re-pinned by re-searching; the cost is low.

Deliverables:
- Updated js/pin-list.js with delete buttons.
- Updated css/styles.css with button styles and focus states.

Verification:
- Add two pins; click the ✕ on one — the row vanishes, the marker vanishes, the other pin is unaffected.
- Refresh — the deleted pin does not return.
- Tab to a delete button and press Enter — same effect as a click.
- Delete every pin — the empty-state message reappears.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Re-rendering the entire list on every change (CORE-008's approach) means click handlers don't need to be reattached separately — they're created fresh each render. That's fine at this scale.
