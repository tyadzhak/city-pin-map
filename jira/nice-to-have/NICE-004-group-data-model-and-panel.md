# NICE-004: Group data model and management panel

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `NICE-004`                                  |
| **Milestone**   | `Nice-to-have`                              |
| **Status**      | `Todo`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M`                                         |
| **Depends on**  | `CORE-003`, `CORE-004`, `CORE-008`          |

## Summary

Introduce a "group" concept (e.g. "2024 Italy trip", "Wishlist", "Coastal cities") that the user can create, rename, recolor, and delete from a panel in the side area. This task delivers the group store and management UI only — assigning pins to groups and rendering by group color is the follow-up (NICE-005). After this task, the user can curate a list of named, color-coded groups, but pins still render with their per-pin color.

## Context

`PROJECT.md` → "Nice-to-have" lists "Group pins (e.g. by trip or theme), with a different color per group." The pin data model in `CLAUDE.md` already includes `group: string | null` and the in-memory store already accepts and round-trips that field (`js/pins.js` → `addPin`), so existing pins on disk remain valid without migration. This task adds the *other* side — the group entities themselves.

The group store mirrors the pin store pattern from CORE-003: a small in-memory array, `add/update/remove/list/replaceAll/subscribe` exports. Persistence mirrors CORE-004: a separate `localStorage` key `'city-pin-map.groups.v1'`, hydrated and subscribed via an `attachGroupStorage` helper, with the same `replaceAll` + subscribe ordering safety used for pins.

The management UI lives in the side `<aside>`, above the existing pin list. CORE-008 introduced the side panel and its conventions (vanilla DOM, full re-render on each store update, accessible buttons) — follow them.

Per `CLAUDE.md` → "What not to do", do not add any framework. The panel is plain DOM elements, like CORE-008's pin list.

## Backward compatibility

- A group entity is shaped: `{ id: string, name: string, color: string (hex #rrggbb), createdAt: number }`. This is a new entity stored under a *separate* localStorage key, so existing saved pin sets are not affected.
- Pins already have `group: null` from CORE-003. This task does NOT touch the pin data model — `pin.group` stays `null` for everyone until NICE-005 wires up assignment.
- If the user has saved groups but their JSON is malformed, the app starts with an empty group list (same defensive pattern as `loadPins`).

## Acceptance criteria

- [ ] A "Groups" section is visible in the side panel above the existing pin list, with a clear heading and an "Add group" affordance.
- [ ] Clicking "Add group" creates a new group with a default name (e.g. "Group 1", incrementing) and a sensible default color, and immediately renders it in the list.
- [ ] Each group row shows the group's name, a color swatch / native color input, and remove and rename affordances.
- [ ] Renaming a group updates the row label and persists across reloads.
- [ ] Changing a group's color updates the swatch and persists across reloads.
- [ ] Deleting a group removes the row and persists across reloads. (Pins continue to render unchanged — assignment isn't wired up yet.)
- [ ] Refreshing the page restores the same set of groups in the same order (id, name, color, createdAt all intact).
- [ ] Group names may be empty strings during editing but trimmed-empty names are rejected on commit (revert to previous, or to a default like `"Untitled group"`).
- [ ] All controls in the panel are keyboard-accessible.
- [ ] No regressions in previously completed tasks.
- [ ] No errors in browser console.

## Files affected

```
+ js/groups.js
+ js/group-panel.js
~ js/storage.js
~ js/app.js
~ index.html
~ css/styles.css
```

## Out of scope

- Assigning pins to groups — that's NICE-005.
- Rendering pins with the group's color — also NICE-005.
- Drag-and-drop reordering of groups; group filtering / visibility toggles; group sharing.
- Bulk creation or import of groups.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Skim js/pins.js (CORE-003), js/storage.js (CORE-004), and js/pin-list.js (CORE-008) — this task copies their patterns deliberately.

Task: Implement the group data model and a management panel. Pins are NOT touched in this task; assignment is NICE-005.

Background you need to know:
- Pins already carry `group: string | null` (CLAUDE.md → "Pin data model"). That is forward-compat; this task does not modify any pin.
- Group entities are stored under a SEPARATE localStorage key from pins. Use `'city-pin-map.groups.v1'`.
- The existing pin store and persistence are the templates: small array, pub/sub, attach pattern.

Requirements:

js/groups.js (new):
- Mirror js/pins.js exactly: a private `groups` array and `listeners` array, a private `notify()` that snapshots and fans out.
- Export `addGroup({ name, color })` → creates `{ id: crypto.randomUUID(), name, color, createdAt: Date.now() }` and notifies. Returns the created group.
- Export `updateGroup(id, patch)` → merges patch (preserving id), notifies.
- Export `removeGroup(id)` → removes by id, notifies.
- Export `listGroups()` → returns a shallow snapshot.
- Export `replaceAll(newGroups)` → swaps and notifies once.
- Export `subscribe(fn)` → returns an unsubscribe.

js/storage.js:
- Add `loadGroups()` / `saveGroups(groups)` mirroring loadPins/savePins (same try/catch + showError pattern).
- Add `attachGroupStorage(groupStore)` that hydrates from localStorage via replaceAll, then subscribes saveGroups. Same hydrate-first, subscribe-second order as attachStorage.

js/group-panel.js (new):
- Mirror js/pin-list.js (CORE-008): full re-render of the panel on every group-store change, plus a one-shot initial render for hydration.
- Render a heading "Groups", an "Add group" button, and one row per group.
- Each row renders:
  - An <input type="text"> bound to `name` (commit on blur / Enter).
  - An <input type="color"> bound to `color` (commit on change).
  - A "Remove" button.
- Use `updateGroup` and `removeGroup` for all mutations. Do NOT manipulate the in-memory array directly.
- Default color for new groups can rotate through a small palette (e.g. ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#264653', '#9d4edd']) so successive "Add group" clicks give visibly distinct defaults.
- Default name: "Group N" where N = current group count + 1.

js/app.js:
- Import the group store and `attachGroupStorage`. Call `attachGroupStorage(groupStore)` during bootstrap, BEFORE initializing the panel UI (same ordering rationale as CORE-004).
- Initialize the group panel after the pin list panel (so the heading order in the aside stays predictable).

index.html:
- Add structural elements for the groups panel inside the existing <aside class="app-side">. Place the groups section ABOVE the pins section.

css/styles.css:
- Style the groups panel consistent with the pins list. Group rows should look visually similar to pin rows but distinct enough that the user can tell them apart.

Constraints:
- Follow the hard rules in CLAUDE.md. No frameworks, no new CDN libraries.
- Color values are hex strings (#rrggbb) only, like the pin color (CORE-011).
- Do NOT change js/pins.js or modify any pin in this task.
- Backward compatibility: an existing user opening the app with no `'city-pin-map.groups.v1'` key in localStorage should see an empty groups list and zero errors.

Deliverables:
- js/groups.js — group store API.
- js/group-panel.js — UI panel.
- Updated js/storage.js with group load/save/attach.
- Updated js/app.js wiring the new store and panel.
- Updated index.html with the groups section in the aside.
- Updated css/styles.css with panel styling.

Verification:
- Open a fresh browser profile (or clear localStorage). The app shows an empty Groups section above the empty Pins section.
- Click "Add group" three times. Three rows appear, each with a default name and a different default color.
- Rename one group to "Italy 2024" — refresh; the new name persists.
- Change another group's color via the swatch — refresh; the new color persists.
- Delete a group — refresh; only the remaining two persist.
- DevTools → Application → Local Storage: confirm a key `city-pin-map.groups.v1` exists with valid JSON, and `city-pin-map.pins.v1` (if present) is unchanged.
- Manually corrupt the groups JSON; reload — empty groups list, error banner appears once, app remains usable.
- Tab through the panel — all controls (Add, name input, color input, Remove) are keyboard-reachable in a sensible order.
- No regressions: pin search, add, color, rename, drag (if NICE-001 landed), route toggle (if NICE-003 landed), and PNG export all still work.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

The choice to keep groups under a separate localStorage key (rather than nesting them inside the pin payload) is deliberate: it keeps each store's serialization independent, matches the existing `'city-pin-map.pins.v1'` versioning, and lets a future task add per-group metadata without forcing a pin-data migration.
