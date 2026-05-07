# CORE-004: localStorage persistence

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-004`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `CORE-003`                                  |

## Summary

Wire `js/storage.js` to the pin store so any change is automatically saved to `localStorage`, and so reloading the page restores the previous pin set. After this task the user's session survives a refresh.

## Context

`PROJECT.md` → "Architectural notes" specifies that `localStorage` is a serializer at save/load points, not the source of truth during a session. So the in-memory store from CORE-003 stays canonical; storage just listens and writes, then bootstraps the in-memory store on load.

`PROJECT.md` → "Risks and mitigations" notes that `localStorage` quota errors should fail gracefully with a user-visible message, never silently.

## Acceptance criteria

- [x] On first load (no saved data), the app starts with an empty pin store and no errors.
- [x] After adding pins via the pin store API, refreshing the page restores the same pins (id, name, lat, lon, color, group, createdAt all intact).
- [x] Removing or updating a pin and refreshing reflects the change after reload.
- [x] Clearing `localStorage` for the site origin and reloading produces an empty pin set with no errors.
- [x] If saving to `localStorage` throws (e.g. quota exceeded), the user sees a visible error message; the in-memory state is still usable.
- [x] If saved JSON is malformed (manually corrupted), the app starts empty and shows a one-time warning rather than crashing.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console under normal operation.

## Files affected

```
~ js/storage.js
~ js/app.js
~ css/styles.css
~ index.html
```

## Out of scope

- No multi-profile or named pin sets — that's a future feature, not Core.
- No export/import to file — Core ships PNG export only (CORE-012).

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Note especially PROJECT.md → "Architectural notes" (in-memory store is canonical, localStorage is a serializer) and "Risks and mitigations" (graceful quota and corruption handling).

Task: Connect js/storage.js to the pin store so changes are persisted and restored across reloads.

Requirements:
- Define a single storage key constant, e.g. `STORAGE_KEY = 'city-pin-map.pins.v1'`. The `.v1` suffix lets us migrate later without colliding.
- Export `loadPins()` → returns an array of pins read from localStorage, or `[]` if nothing is saved or parsing fails.
- Export `savePins(pins)` → serializes the array as JSON and writes it to localStorage. Catches and surfaces errors (quota exceeded, etc.).
- Export `attachStorage(pinStore)` → on call, hydrate the pin store from localStorage (use a bulk-load helper if needed) and subscribe to future changes to persist them. Return an unsubscribe function.
- In js/pins.js, add a `replaceAll(pins)` exported function (or equivalent bulk-load primitive) that swaps the internal array atomically and notifies subscribers exactly once. This is the only way attachStorage should hydrate state.
- In js/app.js, call `attachStorage(pinStore)` during bootstrap, before any UI rendering, so initial render already reflects saved state.
- On save failure, render a non-blocking error banner in the page (a simple `<div id="error-banner">` toggled visible). The banner is reusable for other Core tasks (geocoding errors, export errors).

Constraints:
- Follow the hard rules in CLAUDE.md: no build step, no backend, no frameworks, no paid APIs.
- Don't silently swallow errors (CLAUDE.md → "Coding conventions").
- Don't write to localStorage on every keystroke during rapid mutation; one save per pin-store change is fine, since changes are coarse-grained.

Deliverables:
- js/storage.js — load/save/attach API.
- Updated js/pins.js — adds replaceAll (or equivalent) helper.
- Updated js/app.js — calls attachStorage during bootstrap.
- Updated index.html — adds the #error-banner element.
- Updated css/styles.css — styles for #error-banner.

Verification:
- Open the app, add a pin via the console (using addPin from CORE-003), refresh — pin survives.
- Manually corrupt the saved JSON in DevTools → Application → Local Storage, reload — app starts empty, banner shows a brief warning, no crash.
- Simulate a quota error (DevTools → Application → set storage to small quota, or mock by overriding `localStorage.setItem` temporarily) — banner appears, in-memory state still works.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

The `#error-banner` element introduced here is reused by later Core tasks for geocoding failures (CORE-006/007) and export failures (CORE-012). Keep its API simple — e.g. a small helper `showError(message)` that any module can import.
