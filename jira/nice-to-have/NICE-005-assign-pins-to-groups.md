# NICE-005: Assign pins to groups and render with group color

| Field           | Value                                                      |
|-----------------|------------------------------------------------------------|
| **ID**          | `NICE-005`                                                 |
| **Milestone**   | `Nice-to-have`                                             |
| **Status**      | `Done`                                                     |
| **Priority**    | `Medium`                                                   |
| **Estimate**    | `M`                                                        |
| **Depends on**  | `NICE-004`, `CORE-005`, `CORE-008`, `CORE-011`             |

## Summary

Wire the group entities from NICE-004 to actual pins: each pin row in the side panel gets a "Group" selector (None + every existing group), and any pin assigned to a group renders on the map and in the list using that group's color instead of its individual color. After this task, the user can color-code an entire trip with one click.

## Context

`PROJECT.md` → "Nice-to-have" specifies "Group pins (e.g. by trip or theme), with a different color per group." The group entities and management UI from NICE-004 are already in place; what's missing is the connection from each pin to a group, and the rendering rule that group color wins over per-pin color.

Pins already carry `group: string | null` per `CLAUDE.md` → "Pin data model" — assigning a pin to a group is just `updatePin(pin.id, { group: groupId })`. CORE-005 (`renderPins`) already updates marker color whenever the store notifies, so the only change there is to resolve the rendering color through `groupStore` when `pin.group` is set.

CORE-011 (per-pin color picker) keeps working for ungrouped pins. When a pin is assigned to a group, its individual `color` field is preserved in the data but is *not used for rendering* — so unassigning the group later restores the original individual color.

## Backward compatibility

- Existing pins from CORE-003/004 have `group: null` and continue to render with their individual color exactly as before.
- If a pin has a `group` ID that no longer exists in the group store (e.g. a group was deleted), rendering must gracefully fall back to the pin's individual color and the pin row should display "(none)" in the group selector. Stale-reference is silently tolerated.
- When a group is deleted from NICE-004, this task's logic adds a cleanup step: every pin previously assigned to that group has its `group` set back to `null` via `updatePin`. That keeps the data consistent.

## Acceptance criteria

- [x] Each pin list row displays a "Group" selector (e.g. `<select>`) listing "(none)" plus every existing group.
- [x] Choosing a group from a pin's selector calls `updatePin(pin.id, { group: groupId })`. The map marker recolors to the group's color immediately; the pin list row's swatch reflects the same color.
- [x] Choosing "(none)" sets `pin.group = null` and the marker / row swatch revert to the pin's individual color.
- [x] When a group's color is changed (NICE-004 affordance), every pin currently assigned to that group recolors live on the map and in the list — no manual refresh required.
- [x] When a group is renamed, the new name appears in every pin row's group selector immediately.
- [x] When a group is deleted, every pin previously assigned to that group is automatically reassigned to `(none)`; the pins remain on the map at their original individual color.
- [x] When a pin's data carries a `group` ID that does not exist in the group store (e.g. corruption, manual edit), the pin renders with its individual color and the selector shows "(none)" — no crash, no console error spam.
- [x] The per-pin color picker (CORE-011) remains operable for ungrouped pins. For grouped pins, either disable / hide the per-pin picker, or allow it to silently update `pin.color` (which simply takes effect again on un-grouping). Pick one and document it in the task notes.
- [x] Group assignment persists across reloads.
- [x] No regressions in previously completed tasks (search, rename, remove, drag, color, route toggle, map style, export).
- [x] No errors in browser console.

## Files affected

```
~ js/pin-list.js
~ js/map.js
~ js/group-panel.js
~ js/app.js
~ css/styles.css
```

## Out of scope

- Multi-select assignment ("apply group X to these N pins at once"). One-pin-at-a-time is fine for v2.
- Per-group visibility toggles (showing only one group's pins on the map).
- Per-group polylines or route segments (the route from NICE-003 stays a single chronological line through all pins).
- Per-group iconography (markers stay the same shape; only color changes).

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Then skim js/pins.js, js/groups.js, js/pin-list.js, js/map.js, and js/group-panel.js so you understand the data + render flows already in place.

Task: Assign pins to groups via a per-row selector, render group-colored markers and swatches, and handle group-store cascades.

Background you need to know:
- Pin data already has `group: string | null` (CLAUDE.md → "Pin data model"). Use `updatePin(pin.id, { group: groupId | null })` for all assignment changes. Never mutate pins directly.
- Group entities live in js/groups.js (NICE-004), with subscribe semantics matching the pin store.
- Render rule: a pin's "effective" color is `groupStore.listGroups().find(g => g.id === pin.group)?.color ?? pin.color`.

Requirements:

js/pin-list.js:
- For each pin row, render a `<select>` populated with "(none)" plus every group. The selected option matches `pin.group`. On change, call `updatePin(pin.id, { group: value === '' ? null : value })`.
- Subscribe the pin list to BOTH the pin store and the group store, so a group rename / delete / color change re-renders affected rows immediately. (Either hard re-render the whole list on group changes, or surgically update only the selectors / swatches — your choice. The simpler full re-render is fine; CORE-008 already does that on every pin change.)
- The row swatch shows the EFFECTIVE color (group color when grouped, else pin color). Use the same hex-color rule as CORE-011.
- The per-pin color picker from CORE-011: when a pin is grouped, either hide the picker or visually disable it. Document the chosen behavior in this task's Notes section. Either way, when the pin is ungrouped again, the picker remains functional and `pin.color` is what gets used.
- If a pin's `pin.group` references a group that no longer exists, render the row as if `pin.group === null` (selector shows "(none)") — do NOT auto-rewrite pin data here; just render defensively. The cleanup happens in the group-deletion path below.

js/map.js:
- Import the group store. Replace the call sites in `createMarker` / `updateMarker` that read `pin.color` directly with a small helper, e.g. `effectiveColor(pin)` that resolves through the group store with the same fallback as above.
- Subscribe `renderPins` (or a wrapper in app.js) to the group store too — when a group's color or membership changes, markers must re-render with the new effective color. The simplest implementation: in app.js, on group-store notification, call `renderPins(pinStore.listPins())` so markers refresh against the latest group colors.

js/group-panel.js:
- In the "Remove group" handler, BEFORE calling `removeGroup(id)`, iterate through `pinStore.listPins()` and for each pin where `pin.group === id`, call `updatePin(pin.id, { group: null })`. This guarantees no pin keeps a dangling reference.

js/app.js:
- Wire the group store as an additional dependency for renderPins. Subscribe so any group change re-renders pin markers.
- Make sure the order on bootstrap is: hydrate pins, hydrate groups, render pins, render pin list, render group panel.

css/styles.css:
- Style the per-row group selector to fit the existing pin row layout. Keep keyboard focus rings consistent with other controls.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Do NOT change the pin or group data model. Only `pin.group` mutations are made via `updatePin`.
- Do NOT mutate pins or groups directly outside their store APIs.
- The pin's own `color` field must remain intact when the pin is grouped — un-grouping must restore the original individual color.

Deliverables:
- Updated js/pin-list.js with group selector + effective-color rendering.
- Updated js/map.js with effectiveColor() and group-aware marker color.
- Updated js/group-panel.js with the cascade-clear-on-delete logic.
- Updated js/app.js with the additional group-store subscription wiring renderPins.
- Updated css/styles.css with selector styling.

Verification:
- Create two groups in the panel: "Italy 2024" (e.g. red) and "Wishlist" (e.g. blue).
- Add three pins: Rome, Florence, Tokyo.
- For each of Rome and Florence, pick "Italy 2024" in the row's group selector. Both markers turn red; the row swatches turn red. Tokyo stays whatever its individual color was.
- Change "Italy 2024"'s color to a different hue in the groups panel. Rome and Florence markers and row swatches recolor live without a refresh. Tokyo is unaffected.
- Rename "Italy 2024" to "Italy" — every pin row's group selector reflects the new name.
- Delete "Italy". Rome and Florence markers revert to their individual colors; their row selectors show "(none)"; their `pin.group` in localStorage is `null`.
- For an ungrouped pin, open the per-pin color picker and pick a new color — marker recolors as in CORE-011.
- For a grouped pin, the per-pin picker is hidden (or disabled) per the chosen behavior.
- Refresh the page. All assignments, group colors, and pin individual colors persist.
- Manually edit a pin's saved JSON in DevTools to set `"group":"does-not-exist"`, reload — the pin renders with its individual color, the selector shows "(none)", no console errors.
- Export PNG with a mix of grouped and ungrouped pins — the captured image shows the same effective colors as on screen.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox. In the Notes section, write a single line stating which behavior you chose for the per-pin color picker on grouped pins (hidden vs. disabled).
```

## Notes

Per-pin color picker on grouped pins: **hidden** — the row's hidden `<input type="color">` is omitted from the DOM and the swatch becomes a passive (non-keyboard-focusable, non-clickable) indicator that still shows the effective (group) color. `pin.color` stays intact in the data and the picker reappears the moment the selector is set back to "(none)".

There is no separate per-group polyline in this task. NICE-003 stays a single chronological line through all pins regardless of grouping; per-group routes are a possible future refinement.
