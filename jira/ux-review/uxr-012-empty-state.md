# UXR-012: App opens on the Design tab with zero pins; the "add a city" hint is hidden

| Field           | Value        |
|-----------------|--------------|
| **ID**          | `UXR-012`    |
| **Milestone**   | `UX review`  |
| **Status**      | `Done`       |
| **Severity**    | `Medium`     |
| **Priority**    | `Medium`     |

## Summary

A first-run user saw a blank map and the Design tab; the only hint was small grey text in the hidden Pins tab.

## Context

**Files:** `js/empty-state.js` (new), `js/app.js`, `css/styles.css`, `test/coverage/scenarios/20-map-title-drag.mjs`, `30-map-frame-2.mjs`

## Failure scenario

Open the app fresh: no pins, Design tab active, nothing says to search for a city.

## Fix direction

- New `js/empty-state.js`: a card DOM-created in `.app-map` (sibling of `#map`, so never exported), centered, `z-index` 9 (above overlays, below toasts), with a button that focuses `#search-input`. Subscribes to the pin store, so it hides on the first pin and returns on delete-all, New map, or snapshot/backup loads.
- With zero pins at boot it calls `activateTab("pins")`. This also overwrites the saved tab preference (decision: harmless, since an empty profile has no meaningful preference, and it avoids a second non-persisting path).
- `.pin-list__empty` made darker, larger and bolder.
- Coverage scenarios 20 and 30 seed the Design tab with zero pins; they now click the Design tab after reload.

## Acceptance criteria

- [x] Fresh profile opens on Pins with the card visible. *(Playwright smoke: card visible, `#side-tab-pins` selected.)*
- [x] Adding a pin hides the card. *(Seeded pin + reload: hidden.)*
- [x] Deleting the last pin brings it back. *(Smoke: visible again after Remove.)*
- [x] The export never includes it. *(Card is outside `#map`, which is all export captures; smoke asserts it is not inside `#map`.)*
- [x] Button focuses search. *(Smoke.)*
- [x] `node --check` and `node --test js/*.test.mjs` pass.
