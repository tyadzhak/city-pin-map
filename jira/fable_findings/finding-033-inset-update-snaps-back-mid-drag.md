# FBL-033: Inset `update()` re-places the box mid-drag, snapping it back under the cursor

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-033`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

`js/map-inset.js`'s `update(cfg)` called `applyPlacement(c)` unconditionally, while the other placement paths (`refreshPlacement()` and the main-map-resize `relayoutInset()` added by FBL-025) skipped placement while `boxDragging` was true. Any pin or group store tick during a box drag therefore rewrote the box's pre-drag `left`/`top` and snapped it back under the cursor until the next `pointermove`.

## Context

**Files:** `js/map-inset.js`

- `update()` is wired to both the pin-store and group-store subscriptions (`init()`), so it runs on every store `notify()`.
- PO-004's CSV/foreign-JSON import adds a geocoded pin roughly once per second while the UI stays interactive, so during an import a dragged inset box flickered back about once a second.
- `onBoxPointerMove` writes `left`/`top`/`width`/`height` straight to the overlay's style; `applyPlacement` writes the same properties from `lastCfg.freePos`, which is only updated at pointerup — hence the snap-back.

## Failure scenario

The user drags the inset box while a background import is running. When the next pin lands, `update()` runs `applyPlacement(lastCfg)`, which resolves the stale pre-drag position and writes it to the overlay. The box jumps back to where the drag started until the next `pointermove` repositions it.

## Fix direction

Let the pointer own the box while dragging: `applyPlacement()` itself returns early when `boxDragging` is true, so every caller (`update`, `refreshPlacement`, `relayoutInset`, any future one) honors it in one place. `update()` still records `lastCfg`, refreshes pins/route/label data and refits the camera mid-drag (none of that moves the box). `onBoxPointerUp` ends by calling `relayoutInset()` (placement + canvas re-measure + refit + locator) from `lastCfg`, whose `freePos` is the just-dropped position, so anything deferred during the drag is applied on release.

## Acceptance criteria

- [x] A pin/group store tick during a box drag no longer moves the box away from the pointer. *(Runtime-only to fully confirm; by construction: `applyPlacement` is the sole writer of overlay geometry besides `onBoxPointerMove`, and it now no-ops while `boxDragging`.)*
- [x] `update()` mid-drag still records the latest `cfg` in `lastCfg` and refreshes pins/route/labels, so a pin added mid-drag appears in the inset. *(Runtime-only to fully confirm; `lastCfg = c` and `renderInsetData`/`fitInset`/`refreshLocator` are unchanged and still run.)*
- [x] A config change made during the drag (e.g. width/height) is applied no later than release. *(Runtime-only; `onBoxPointerMove` already resolves size from `lastCfg`, and `onBoxPointerUp` now calls `relayoutInset()`, which re-places, re-measures and refits from `lastCfg`.)*
- [x] Every `applyPlacement` caller honors `boxDragging` consistently. *(Audited: `update`, `refreshPlacement`, `relayoutInset` — all go through the guarded helper; the redundant per-caller check in `relayoutInset` was removed.)*
- [x] The drag's own `pointermove` positioning and the persisted `freePos` derivation are unchanged. *(Only the tail of `onBoxPointerUp` changed: it no longer early-returns before `relayoutInset()`.)*
- [x] `node --check js/map-inset.js` passes and `node --test js/*.test.mjs` passes. *(Both clean.)*
- [ ] No errors in the browser console / no snap-back observed in a real drag with a concurrent store update. *(Runtime-only; to be confirmed by the verifier with a headless-Playwright scenario.)*

## Files affected

```
~ js/map-inset.js
+ jira/fable_findings/finding-033-inset-update-snaps-back-mid-drag.md
```

## Notes

Follow-up to FBL-025 (which added the `relayoutInset()` drag guard but left `update()` unguarded). No unit test: `map-inset.js` is DOM/WebGL-heavy and has no node tests.
