# FBL-008: Pins can be dragged away from their real location — trivially by accident, irreversibly, with no undo or reset

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-008`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Medium` (data integrity / UX)              |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | None                                        |

## Summary

A pin represents a real city ("Berlin, Germany"), but a plain left-button drag on the marker silently rewrites its coordinates and persists them. Berlin cannot move in reality; in the app it moves if the user's pan gesture happens to start on top of a pin. The mutation commits straight to the store and `localStorage` with **no undo, no confirmation, and no way to restore the geocoded position** — the original coordinates are not retained anywhere, so recovery requires deleting the pin and re-searching the city. At low zoom, an accidental few-pixel drag displaces a city by hundreds of kilometers, and the user may not notice until much later (or after an export).

## Context

**File:** `js/map.js`

- Lines 1093–1126 (`attachPinInteractions`): a bare `mousedown` on the pins layer (`button === 0`, no modifier required) starts a drag and disables `dragPan` — so the most natural map gesture, click-and-drag to pan, moves the pin instead whenever the cursor is over one. The `grab` cursor advertises this.
- Lines 1146–1164 (`onDocUp`): drag commit calls `updatePin(pinId, { lat, lon })` → store notify → `savePins` persists immediately.
- The pin data model (CLAUDE.md → "Pin data model") has no field preserving the geocoded origin, so the true location is unrecoverable after any drag.

Drag itself is a deliberate Core-milestone feature and has a legitimate use: Nominatim returns administrative centroids that can sit awkwardly for a poster (in a river, off-center at low zoom), and nudging the marker is useful for composition. The bug is the *interaction and recovery design around it*: an irreversible, accident-prone mutation triggered by the same gesture as panning, with no guard and no way back. Product owner decision (2026-07-03): treat as a bug.

## Steps to reproduce

1. Search and add "Berlin" — pin lands at the geocoded location.
2. Zoom out to world view, then click-and-drag to pan the map, starting the gesture with the cursor over the Berlin pin (easy to do unintentionally — the pin is exactly where the eye is looking).
3. **Observed:** the map does not pan; the pin slides. On release, Berlin now sits in e.g. Poland. The change is already persisted; there is no undo, and no way to restore the correct coordinates short of deleting the pin and re-searching.
4. **Expected:** panning never moves a pin by accident; if a pin is moved deliberately, the user can restore its true geocoded position.

## Acceptance criteria

- [x] A click-drag that the user intends as a map pan cannot move a pin unintentionally. **Decided guard: Alt/Option-drag** (PO approval 2026-07-03, see Notes) — plain drag over a pin pans the map; Alt-drag moves the pin.
- [x] Deliberate repositioning is still possible (the centroid-nudging use case survives).
- [x] Each pin retains its original geocoded coordinates (`originalLat`/`originalLon`, added as **optional** fields per CLAUDE.md's data-model rule) from the moment of creation.
- [x] A moved pin exposes a "Reset position" affordance (pin-list row action or similar) that restores the geocoded coordinates.
- [x] Pins created before this change (no original coords stored) degrade gracefully: no crash, reset affordance hidden or seeded from current position.
- [x] Backup export/import (v2) round-trips the new optional fields without breaking v1/v2 import (coordinate with FBL-004 if both are implemented).
- [x] No regressions in existing drag, rename, group, and render flows.
- [x] No errors in browser console.

## Files affected

```
~ js/map.js
~ js/pins.js
~ js/search.js
~ js/pin-list.js
~ js/import-foreign.js
~ CLAUDE.md   (Pin data model section — new optional fields)
```

## Out of scope

- A general undo/redo system for all pin mutations (bigger feature; the reset-to-origin affordance covers the destructive case here).
- Touch-device drag support (drag is currently mouse-only; keep parity, don't expand).
- Re-geocoding on reset (the stored original coordinates make a network call unnecessary).

## Implementation prompt

> Paste into a coding agent:

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md.

Task: Make pin repositioning deliberate and reversible. Pins represent real cities; accidental drags currently corrupt their coordinates permanently.

Requirements:
- Guard the drag: in js/map.js attachPinInteractions, only start a pin drag when a modifier key is held (recommend Alt/Option — document it in the pin row's tooltip and the pin layer's hover cursor: default cursor stays the map's, grab cursor only with modifier down). A plain drag over a pin must pan the map normally (do not disable dragPan, do not preventDefault).
- Preserve origin: extend the pin model with optional originalLat/originalLon, set once at creation time in every add path (js/search.js selectResult, js/import-foreign.js applyRows — both coordinate and geocoded branches). Do NOT update them on drag. Update CLAUDE.md's Pin data model section accordingly (fields optional; import/backup tolerance per existing conventions).
- Reset affordance: in js/pin-list.js, when a pin's current lat/lon differ from originalLat/originalLon (and originals exist), render a small "reset position" button (e.g. ⟲) on the row that calls updatePin(id, { lat: originalLat, lon: originalLon }).
- Old pins without originals: no reset button, no crash.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- New model fields must be optional — never crash on pins that lack them (mirrors the stale-group contract).
- Keep the drag-commit path (updatePin on mouseup) otherwise unchanged.

Verification:
- Plain click-drag starting on a pin pans the map; the pin does not move.
- Alt-drag moves the pin; the pin list shows the reset button; clicking it snaps the pin back to the geocoded location; button disappears.
- Reload persists both current and original coordinates; export/import JSON round-trips them.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Raised by the product owner after the 2026-07-03 review ("Berlin cannot in reality move on the map"). Drag was shipped intentionally in the Core milestone, so this was not auto-filed during the correctness pass; it is now classified as a bug on data-integrity grounds: same-gesture collision with panning + irreversible silent persistence. **Guard decision: Alt/Option-drag — approved by the product owner 2026-07-03.** Rationale: needs no new UI, keeps one-handed panning safe, and preserves deliberate repositioning behind an explicit modifier. A lock toggle was considered and rejected as heavier (extra header control, extra persisted preference) for the same protection.
