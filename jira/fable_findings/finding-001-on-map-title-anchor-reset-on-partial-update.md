# FBL-001: On-map title anchor resets to map center on every text edit or formatting change

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-001`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `High`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | None                                        |

## Summary

`mapTitle.update()` is documented and used as a merge-over-existing partial update, but its `lon`/`lat` handling falls back to `null` instead of the current position. Every partial update (each keystroke in the title input, every bold/italic/font/color/size change) wipes the stored anchor and re-seeds it from the current map center — silently discarding the position the user dragged the title to, and persisting the wrong position to `localStorage`.

## Context

**File:** `js/map-title.js`, lines 110–119 (the merge inside `update()`), interacting with the re-seed branch at lines 137–142.

```js
position = {
  text: typeof next.text === "string" ? next.text : position.text,
  lon: Number.isFinite(next.lon) ? next.lon : null,     // ← BUG: should fall back to position.lon
  lat: Number.isFinite(next.lat) ? next.lat : null,     // ← BUG: should fall back to position.lat
  font: typeof next.font === "string" ? next.font : position.font,
  ...
};
```

Every other field merges over the existing value (`position.font`, `position.bold`, …), exactly as the comment above the block promises ("a partial caller (e.g. 'just toggle bold') doesn't have to know about every field"). Only `lon`/`lat` violate the contract.

The callers in `js/app.js` (`initOnMapTitle`, lines 338–380) pass single-field partials: `apply({ text: input.value })`, `apply({ bold: next })`, etc. After the merge nulls the anchor, `update()` reaches the "seed from map center on first reveal" branch (`map-title.js:137`) because text is non-empty, overwrites `lon`/`lat` with the current center, and fires `onAnchorChange` — which `app.js` wires to `saveOnMapTitle()`, persisting the corrupted anchor.

The bug is masked in the most common demo flow (type text, never pan, export) because the seeded center coincides with where the title was. It surfaces as soon as drag/nudge and editing are combined.

## Steps to reproduce

1. Open the app, type a title in the "On-map title" input (overlay appears at map center).
2. Drag the overlay to a corner of the map, or nudge it with arrow keys.
3. Pan the map so its center is somewhere else.
4. Type one more character in the title input (or click the Bold toggle).
5. **Observed:** the overlay jumps from the dragged position to the current map center; a reload confirms the wrong position was persisted.
6. **Expected:** the overlay stays where the user placed it; only the edited field changes.

## Acceptance criteria

- [x] Editing the title text after dragging the overlay does not move the overlay.
- [x] Toggling bold/italic, changing font, color, or size does not move the overlay.
- [x] Explicitly passing finite `lon`/`lat` in `update()` still repositions the overlay (boot hydration path unchanged).
- [x] Passing `lon: null` deliberately (no current caller does) still resets the anchor — or the reset path is removed if deemed unreachable; either way document the choice. (Chosen: merge-over-existing semantics — `lon`/`lat` now fall back to `position.lon`/`position.lat` like every other field, so a deliberate `null` no longer resets a set anchor. The seed-from-map-center reset only fires on genuine first reveal, when `position.lon`/`lat` are still null. This matches the contract of all other fields.)
- [x] The persisted `localStorage` value tracks the dragged position across edits.
- [x] No regressions in previously completed tasks (PO-008/PO-009 acceptance flows).
- [x] No errors in browser console.

## Files affected

```
~ js/map-title.js
```

## Out of scope

- The parallel `normalizeOnMapTitle()` clamp in `js/storage.js` (correct as-is; it validates full objects, not partials).
- The export-side projection in `js/export.js` (consumes storage state; fixed automatically once the anchor persists correctly).

## Implementation prompt

> Paste into a coding agent:

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md.

Task: Fix the on-map title overlay losing its dragged position on partial updates.

Requirements:
- In js/map-title.js update(), make lon/lat merge over the existing position the same way font/bold/italic/color/size do: fall back to position.lon / position.lat when next.lon / next.lat are not finite numbers.
- Preserve the "seed from map center" behaviour for the genuine first-reveal case (position.lon/lat still null after the merge).
- Verify all call sites: app.js passes partials ({ text }, { bold }, …) and one full object at boot (mapTitle.update(saved)); both must behave.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Two-line fix expected; do not restructure the module.

Verification:
- Open index.html, type a title, drag it off-center, pan the map, then type another character and toggle Bold — the overlay must not move.
- Reload the page — the overlay reappears at the dragged position.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Found during a full-codebase correctness review (2026-07-03). The doc comment in `update()` already describes the intended merge semantics — the implementation of two fields just doesn't match it.
