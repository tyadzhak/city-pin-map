# UXR-010: First group's colour equals the default pin colour

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-010`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Medium`                                    |
| **Priority**    | `Medium`                                    |

## Summary

The first palette entry for new groups (`#e63946`) equalled `DEFAULT_PIN_COLOR`, so assigning inherited pins to the first group changed nothing visually.

## Context

**Files:** `js/groups.js`, `js/group-panel.js`, `js/map-select.js`, `js/groups.test.mjs`

- `group-panel.js` and `map-select.js` each held a private copy of the same palette indexed by group count.

## Failure scenario

User adds "Group 1", assigns pins to it, and sees no colour change ("did it work?").

## Fix direction

Added a shared palette (`GROUP_PALETTE`, red moved off the first slot) and pure `pickGroupColor(existingGroups, defaultPinColor)` in `js/groups.js`. It returns the first palette colour that is neither the default pin colour (case-insensitive) nor used by a group, else rotates while still skipping the default. Both entry points now call it with `loadDefaultPin().color`; the duplicated palettes were removed.

## Acceptance criteria

- [x] A new group never defaults to the current default-pin colour. *(Test "never returns the default pin color".)*
- [x] Consecutive groups get distinct colours. *(Test with 5 groups; rotation test beyond the palette.)*
- [x] Both entry points share the helper. *(group-panel.js and map-select.js import `pickGroupColor`.)*
- [x] Tests pass. *(`js/groups.test.mjs` 15/15.)*
