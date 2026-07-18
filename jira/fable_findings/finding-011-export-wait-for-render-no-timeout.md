# FBL-011: `waitForRender` has no timeout — export can hang forever with the map stuck off-screen

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-011`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `High`                                      |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | None                                        |

## Summary

`waitForRender` in `js/export.js` awaits a bare `once("render")` with no timeout, unlike `waitForIdle`'s existing timeout race. It is called both from the fast export path and from inside `captureFramed`'s try block — in the preset-export case, AFTER the map has already been reparented off-screen for capture. If the awaited `render` event never fires (e.g. WebGL context loss between `triggerRepaint` and the event), the promise never settles, `captureFramed`'s `finally` never runs, and the map is left permanently off-screen and invisible, with the export button permanently disabled and no error shown.

## Context

**Files:** `js/export.js`

- `js/export.js:573-575` — bare `once("render")`, no timeout (contrast `waitForIdle`'s timeout race at `js/export.js:555-568`).
- `js/export.js:142-143` — called on the fast path.
- `js/export.js:230-231` — called inside `captureFramed`'s try block, AFTER the map was reparented off-screen at `js/export.js:214-215`.
- `js/app.js:459-471` — disables the export button across the entire await, so a hang here is a fully stuck UI, not just a slow one.

## Failure scenario

WebGL context loss (or any other reason the `render` event never fires) between `triggerRepaint()` and the event firing → the `waitForRender` promise never settles → `captureFramed`'s `finally` block never runs → the map stays reparented off-screen (visibly gone from the page) and the export button stays disabled forever, with no error shown. Reloading the page is the only recovery.

## Fix direction

Give `waitForRender` the same race-against-timeout treatment `waitForIdle` already has, so the pipeline always settles into the existing `catch`/`finally` cleanup path (which restores the map's DOM position and re-enables the export button) even when the `render` event never arrives.

## Acceptance criteria

- [x] `waitForRender` resolves (or rejects) within a bounded timeout even if the MapLibre `render` event never fires. — now races `once("render")` against a `setTimeout(RENDER_WAIT_TIMEOUT_MS = 2000)`, mirroring `waitForIdle`; whichever fires first calls `finish()`, which de-registers the loser and resolves exactly once.
- [~] On timeout, the existing `catch`/`finally` cleanup runs: the map is restored to its normal DOM position and the export button is re-enabled. — statically true: because the promise now always settles, both `await waitForRender(...)` sites return, `captureFramed`'s `finally` re-attaches the map and resets pin-label size, and `app.js`'s `finally` re-enables the export button. **Deviation:** no error banner is shown on timeout — per the coordinator's fix direction we RESOLVE (not reject), so the export completes with the current framebuffer (a possibly-stale but valid PNG), matching `waitForIdle`'s philosophy; a spurious "Could not export" banner on a successful download would mislead. Runtime confirmation of the DOM-restore/button-reenable behaviour still pending (needs a live WebGL-context-loss repro).
- [~] No regression to normal export flows (fast path and preset path) when `render` fires promptly, per the evidence above. — statically transparent (on a prompt `render`, `finish()` clears the timer and detaches the listener before resolving, exactly as before); runtime confirmation pending manual export of a current-view and a preset.
- [x] `node --check` passes on all changed modules. — `node --check js/export.js` clean.
- [ ] No errors in the browser console. — runtime-only; not exercised in this static fix pass.

## Files affected

```
~ js/export.js
```

## Notes

Review id: F3. Third in the strict fix order (see `tmp/confirmed-findings.md`); may also touch `js/app.js` if the button re-enable logic needs adjusting, but no same-file predecessor exists yet. Filed from a coordinator-verified full-app review, 2026-07-18.
