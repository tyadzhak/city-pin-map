# CORE-008: Pin list panel UI

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-008`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `CORE-005`                                  |

## Summary

Render the current pin set as a scrollable list in the side panel. Each row shows the pin's name and a color swatch. The list re-renders on every pin store change. This is the surface where remove/rename/color tasks (CORE-009/010/011) attach their controls.

## Context

CORE-005 already subscribes to the pin store from the map side. This task adds the parallel subscription for the side panel introduced in CORE-001. Splitting "list rendering" from "list operations" keeps each task small: this one is just visual; CORE-009/010/011 add buttons and inline editors.

`PROJECT.md` → "Milestones → Core" requires "Display a list of all current pins with edit and delete." This task delivers the display half.

## Acceptance criteria

- [x] The side panel shows a heading like "Pins" and a list (`<ul>` or similar) underneath.
- [x] Each list row corresponds to one pin and displays: a colored swatch matching the pin's color, and the pin's name.
- [x] Rows are ordered by `createdAt` ascending (oldest first) so newly added pins appear at the bottom.
- [x] Adding a pin via search appends a new row immediately.
- [x] Removing a pin from the store removes its row.
- [x] Updating a pin's name updates the row's text in place; updating its color updates the swatch in place.
- [x] When the list is empty, an empty-state message is shown (e.g. "No pins yet — search for a city above.").
- [x] The list is keyboard-accessible (rows are reachable via Tab if they are interactive in later tasks; for now plain text rows are fine).
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ index.html
~ css/styles.css
~ js/app.js
+ js/pin-list.js
```

## Out of scope

- No remove buttons (CORE-009).
- No rename UI (CORE-010).
- No color picker (CORE-011).
- No "fly to pin on row click" — desirable but a v2 polish item.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Note PROJECT.md → "Milestones → Core" — this task only delivers the display half of "Display a list of all current pins with edit and delete."

Task: Build js/pin-list.js to render the pin store into the side panel.

Requirements:
- In index.html, give the side panel a clear structure: a heading element with "Pins", and a container element such as <ul id="pin-list"></ul>. Reserve a small element for the empty-state message, e.g. <p id="pin-list-empty">No pins yet — search for a city above.</p>.
- New module js/pin-list.js exports `initPinList()`. It:
  - Subscribes to the pin store.
  - Re-renders the list on every change (a full re-render is fine at Core scale; do not optimize prematurely per CLAUDE.md → "What not to do").
  - Sorts pins by createdAt ascending before rendering.
  - For each pin, renders a row with: a swatch (a span with `style="background: <pin.color>"` and a CSS class for sizing) and the pin's name.
  - Toggles `#pin-list-empty` visibility based on whether there are any pins.
- In js/app.js, call `initPinList()` during bootstrap, after pin store hydration.
- In css/styles.css, style the list and swatches: rounded swatch, fixed size, spaced row layout, scroll behavior when the list is taller than the panel.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Vanilla DOM (`document.createElement`, `appendChild`, etc.) — no template strings injected via `innerHTML` for user-controlled values to avoid XSS. The pin name is user-provided (or geocoder-provided), so use `textContent`.
- Do not add interactive controls (delete button, etc.) in this task — those are subsequent Core tickets.

Deliverables:
- New js/pin-list.js exporting `initPinList()`.
- Updated index.html with the side-panel list structure.
- Updated css/styles.css with list and swatch styles.
- Updated js/app.js wiring the list init.

Verification:
- Add three pins via the search UI. The side panel shows three rows in the order they were added, each with the right name and color swatch.
- Remove a pin via the console (`removePin(id)`); the matching row disappears.
- Update a pin's name and color via the console (`updatePin(id, { name: 'Renamed', color: '#1d3557' })`); the row's text and swatch update.
- Refresh the page; the list reflects persisted pins.
- Empty the store; the empty-state message appears.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Use `textContent` (not `innerHTML`) to inject the pin name. The geocoder's `display_name` field is third-party text and could in principle contain HTML-like characters; using `textContent` makes that safe by default.
