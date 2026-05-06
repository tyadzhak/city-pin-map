# CORE-003: In-memory pin store with pub/sub

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-003`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `CORE-001`                                  |

## Summary

Build the central pin store in `js/pins.js` — the single in-memory source of truth for the pin set, with `add`, `remove`, `update`, `list`, and a simple `subscribe` API. Every later UI task reads from and writes to this module.

## Context

`CLAUDE.md` → "Coding conventions" mandates a single in-memory pin store with UI subscribing via simple pub/sub. `CLAUDE.md` → "Pin data model" defines the exact pin shape — every field must be preserved on add/update.

This task is data-only: no UI, no map markers, no persistence. Those come in CORE-004 (storage), CORE-005 (map markers), and CORE-008 (list panel).

## Acceptance criteria

- [ ] `js/pins.js` exports `addPin`, `removePin`, `updatePin`, `listPins`, and `subscribe` as named exports.
- [ ] `addPin({ name, lat, lon, color })` creates a pin with an auto-generated `id` (e.g. `crypto.randomUUID()`), `createdAt: Date.now()`, and `group: null`, returning the new pin.
- [ ] `removePin(id)` removes the pin with that id; calling it with an unknown id is a no-op (no throw).
- [ ] `updatePin(id, patch)` shallow-merges `patch` into the matching pin and preserves all other fields.
- [ ] `listPins()` returns a fresh array (not a live reference) so callers can't mutate internal state.
- [ ] `subscribe(fn)` registers a listener that fires after every mutation; it returns an `unsubscribe()` function.
- [ ] All mutation paths (`addPin`, `removePin`, `updatePin`) call subscribers exactly once with the new pin list.
- [ ] Calling subscribers does not throw if one subscriber throws (other subscribers still fire) — log the error and continue.
- [ ] No regressions in previously completed tasks.
- [ ] No errors in browser console.

## Files affected

```
~ js/pins.js
```

## Out of scope

- No persistence (CORE-004 wires `localStorage`).
- No rendering on the map or list (CORE-005, CORE-008).
- No grouping behavior beyond storing `group: null` on each pin — grouping is a v2 nice-to-have.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Pay close attention to CLAUDE.md → "Pin data model" — the exact shape every pin must conform to.

Task: Implement js/pins.js as an in-memory pin store with a small pub/sub layer. No DOM, no I/O.

Requirements:
- Module-scoped `pins` array (private — not exported).
- Module-scoped `listeners` array (private).
- Exported functions:
  - `addPin({ name, lat, lon, color, group? })` → creates a full pin matching CLAUDE.md's data model (auto-fill `id`, `createdAt`, default `group: null` if omitted) and returns it.
  - `removePin(id)` → removes by id; unknown id is a no-op.
  - `updatePin(id, patch)` → shallow merge `patch` onto the existing pin; ignore unknown ids.
  - `listPins()` → returns a copy of the array (e.g. `pins.slice()`).
  - `subscribe(fn)` → pushes `fn` onto listeners and returns `() => { /* remove fn */ }`.
- After every successful mutation, call every listener with `listPins()`. Wrap each listener call in try/catch so one bad listener doesn't break the others — log the error to console.error.
- Use `crypto.randomUUID()` for ids.

Constraints:
- Follow the hard rules in CLAUDE.md: no build step, no backend, no frameworks.
- ES module syntax. `async`/`await` over `.then()` chains where applicable (none expected here, but keep the convention in mind).
- No comments explaining what the code does — only why, when non-obvious.

Deliverables:
- js/pins.js with the API described above.

Verification:
- Open the browser console on the running app and import the module manually (or temporarily call from app.js):
  - `addPin({ name: 'Tokyo', lat: 35.68, lon: 139.69, color: '#e63946' })` returns a pin with all fields populated.
  - A subscriber registered before the call fires once with a one-element array.
  - `updatePin(id, { name: 'Tokyo, Japan' })` updates only `name`; other fields untouched; subscriber fires.
  - `removePin(id)` empties the array; subscriber fires.
  - `removePin('nonexistent')` does nothing; no error.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Keep this module pure JS — the temptation to call `localStorage` here is real but wrong. `js/storage.js` (CORE-004) wraps the store from outside, so the store stays unit-testable without a browser.
