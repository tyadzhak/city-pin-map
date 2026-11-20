# UXR-007 — Clicking a pin on the map or in the list does nothing

- **ID:** UXR-007
- **Milestone:** UX review
- **Status:** Done
- **Severity/Priority:** High

## Summary
Pins were inert: no click on the map icon, its label, or its list row did anything, and the cursor said "grab" over pins.

## Context (files)
`js/map.js`, `js/map-labels.js`, `js/pin-list.js`, `js/side-tabs.js`, `js/tips.js`, `css/styles.css`.

## Failure scenario
A user with many pins sees one on the map and cannot find its row; or picks a row and cannot find it on the map.

## Fix direction
- `map.js`: click on the pins-fill and color-ring layers dispatches a `city-pin-map:pin-selected` DOM event (Shift-clicks ignored); pointer cursor on hover.
- `map-labels.js`: a label pointerup with < 4px travel is a click (dispatches the same event, no offset write); larger travel remains a drag.
- `side-tabs.js`: new `activateTab(name)` export.
- `pin-list.js`: on the event, switch to the Pins tab, pulse the label, scroll the row into view and highlight it (class fades after 2.5 s or on next selection; survives re-renders). Row body click (not tile/swatch/select/buttons/input; `event.detail > 1` ignored so double-click rename works) selects and flies via `flyToPin` (keeps zoom if >= 4, else zooms to 5), animation off under reduced motion.
- `tips.js`: two new tips.

## Acceptance criteria
- [x] Map pin click selects and highlights the row in the Pins tab (Playwright: tab selected, row highlighted).
- [x] Row click moves the map to the pin (center lng 0 -> 77.2, zoom 5).
- [x] Label drag still works, without selecting (labelDx/Dy written, no selected row).
- [x] Box-select still opens its popover (fresh-view smoke: panel present).
