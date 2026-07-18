# FBL-013: Export reads persisted frame/title from storage instead of live in-memory state

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-013`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | `FBL-012` (same file: `js/export.js`); also touches `js/app.js` (last touched at `FBL-011`) |

## Summary

The export pipeline re-reads the on-map frame and title from `localStorage` at click time (`loadExportFrame()`, `loadOnMapTitle()`), rather than consuming the same in-memory state the live overlays render from. `saveExportFrame`/`saveOnMapTitle` swallow `setItem` failures with only a transient "kept in memory only" banner. When a save fails, the live overlay (rendered from in-memory state) and the exported PNG (rendered from stale persisted state) silently diverge, contradicting both the screen and the banner's own wording.

## Context

**Files:** `js/export.js`, `js/app.js`

- `js/export.js:116` — `loadExportFrame()` re-reads localStorage at export click time.
- `js/export.js:126` — `loadOnMapTitle()` re-reads localStorage at export click time.
- `js/app.js:307` — live frame overlay renders from in-memory state (`mapFrame.update`).
- `js/app.js:401` — live title overlay renders from in-memory state (`mapTitle.update`).
- `js/storage.js:309-318` — `saveExportFrame` swallows `setItem` failure with a transient banner, no rethrow.
- `js/storage.js:409-421` — `saveOnMapTitle` swallows `setItem` failure with a transient banner, no rethrow.

## Failure scenario

`localStorage` is at quota. User edits the title or frame — the live overlay shows the new value, and a banner says "kept in memory only." The user then clicks Export: the exported PNG renders the OLD persisted value, contradicting both what's visible on screen and what the banner just told them.

## Fix direction

Export should consume the same live in-memory state the overlays render from — e.g. accept the current frame/title from the caller (`app.js`), or read a live accessor (`mapTitle.getPosition()` / an equivalent live frame accessor) — rather than re-reading `localStorage` at click time.

## Acceptance criteria

- [x] Exporting after a save failure (localStorage at quota, "kept in memory only" banner shown) produces a PNG matching the live on-screen overlay state, not the stale persisted value. — By design: `initExportButton` now reads the live frame (`normalizeFrame(readFrame())`, the same DOM read `mapFrame.update` uses) and the live title (`mapTitle.getPosition()`, the overlay's own in-memory state) at click time and passes both into `exportMapAsPng`, which prefers them over `loadExportFrame()`/`loadOnMapTitle()`. Runtime-only: exercising a real quota failure requires the browser.
- [x] Normal exports (successful prior save) are unchanged — persisted and in-memory state agree, so no visible behavior change in the common case. — The passed-in frame is normalized through the exact `normalizeFrame` that `loadExportFrame()` applies, and the title runs through the same `prepareOnMapTitle`; when a save succeeded the live and persisted values are identical, so the composite is byte-for-byte the same. Fallback to storage is preserved when the caller passes nothing (standalone use). Runtime confirmation is browser-only.
- [x] No regression to the live overlay rendering path (`js/app.js` `mapFrame.update`/`mapTitle.update`) described in the evidence above. — Untouched: the `persist()`/`mapFrame.update` and `apply()`/`mapTitle.update` wiring is unchanged; the fix only *adds* accessors (`getLiveFrame`/`getLivePosition`) at the ends of `initExportFrameOptions`/`initOnMapTitle`.
- [x] `node --check` passes on all changed modules. — `js/storage.js`, `js/export.js`, `js/app.js` all pass.
- [ ] No errors in the browser console. — Runtime-only; not verifiable statically (no git/build here). Static syntax check is clean.

## Files affected

```
~ js/export.js
~ js/app.js
```

## Notes

Review id: F7. Must land after FBL-012 — same file (`js/export.js`). Filed from a coordinator-verified full-app review, 2026-07-18.
