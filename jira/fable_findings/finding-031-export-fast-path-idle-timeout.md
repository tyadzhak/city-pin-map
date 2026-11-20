# FBL-031: Export fast path always waits the full 8 s tile timeout

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-031`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

When nothing needs compositing (no pins/labels, no on-map title, no fade, no inset, "Current view" preset), `exportMapAsPng()` took the no-composite fast path, which awaited `waitForIdle(...)` BEFORE calling `map.triggerRepaint()`. MapLibre emits `idle` only from inside a render frame, and an already-settled map schedules no frames on its own, so the wait always ran to `TILE_WAIT_TIMEOUT_MS` (8000 ms). An empty-map export therefore showed "Rendering…" for about 8 s every time. The comment on `waitForIdle` claimed `once('idle')` "resolves on the next tick" for an already-idle map, which is wrong.

## Context

**Files:** `js/export.js`

- Fast-path branch in `exportMapAsPng()` — `await waitForIdle(...)` then `triggerRepaint()` then `waitForRender(...)`.
- `waitForIdle()` doc comment — incorrect "already idle resolves on the next tick" claim.
- Verified against the pinned `maplibre-gl@4.7.1` dist: `Map#_render()` fires `idle` only inside a frame, after `render`, when `!somethingDirty && !this._repaint && !isMoving() && loaded()`. `triggerRepaint()` schedules exactly such a frame; nothing else does on a settled map.

## Failure scenario

Boot with no pins, title/fade/inset off, preset "Current view", let the map settle, click Export PNG. No frame is rendered, `idle` never fires, and the export sits out the 8 s timeout before the (already valid) canvas is read and downloaded.

## Fix direction

Arm the idle listener first, then trigger the repaint, then await idle, so the repaint frame itself both draws the current state and fires `idle`.

## Acceptance criteria

- [x] Fast-path export on a settled, empty map no longer waits the 8 s timeout; the idle wait is armed before `triggerRepaint()` so the repaint frame fires `idle`. *(By construction from the 4.7.1 `_render` source; wall-clock confirmation is runtime-only.)*
- [x] The canvas read afterwards is valid, not blank. *(The main map is created with `preserveDrawingBuffer: true` in `js/map.js`, so the framebuffer drawn by the idle-firing frame persists after the await; the read does not need to occur inside a render callback. On timeout the framebuffer still holds the last rendered frame, same as before.)*
- [x] Still waits for tiles when they are loading. *(`idle` is not emitted until `loaded()`; the wait continues to the frame that finishes loading, bounded by `TILE_WAIT_TIMEOUT_MS`.)*
- [x] The wrong `waitForIdle` comment is corrected. *(States that `idle` is emitted only from a render frame and callers must ensure one is coming.)*
- [x] Non-fast path (`captureFramed`) unchanged. *(Its main-map idle wait follows `mapInstance.resize()`, which schedules a frame, so it does not have this ordering bug; the inset wait follows `relayoutInset()`, which resizes the inset map the same way.)*
- [x] `node --check js/export.js` passes and `node --test js/*.test.mjs` passes (426/426).
- [ ] No errors in the browser console and a real export completes in well under 8 s with a non-blank PNG. *(Runtime-only; requires a browser.)*

## Files affected

```
~ js/export.js
+ jira/fable_findings/finding-031-export-fast-path-idle-timeout.md
```

## Notes

The `captureFramed` inset path relies on `relayoutInset()` causing the inset map to resize and so render a frame; if that were ever a no-op on an unchanged size, the same wait-to-timeout pattern would apply there (and would throw, by design). Not changed here; not observed as a bug.
