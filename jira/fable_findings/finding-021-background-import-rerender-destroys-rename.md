# FBL-021: Background import re-render destroys an in-progress pin rename

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-021`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed — fix-blind (originally needs-review)` |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | None                                        |

## Summary

`pin-list.js` subscribes its render function to every pin-store `notify()`, and render does a full `replaceChildren()` rebuild. A comment in the code documents the original assumption — that mutations only happen from user actions that would have already blurred any open rename input — but PO-004's background CSV/foreign-JSON import loop adds pins roughly once per second while the UI stays interactive, violating that assumption: a rename can now be in progress while an unrelated background mutation triggers a full rebuild.

## Context

**Files:** `js/pin-list.js`

- `js/pin-list.js:45` — render subscribed to every store `notify()`.
- `js/pin-list.js:73` — render does a full `replaceChildren()` rebuild.
- `js/pin-list.js:69-72` — comment documenting the now-violated assumption ("mutations only happen from user actions that would have blurred the input").
- Context: PO-004's import loop (`js/import-foreign.js`) adds pins to the store in the background at roughly one per second while the panel remains interactive.

## Failure scenario

A user starts renaming a pin while a CSV import is running in the background. The next geocoded pin lands in the store, triggering a full list rebuild — the focused rename `<input>` is ripped out of the DOM mid-keystroke. The edit is silently discarded, or (depending on browser blur/commit timing) unexpectedly partially committed.

## Fix direction

Guard the rebuild against an active rename: defer the re-render while a rename input is focused, re-rendering on blur/commit instead, or preserve and re-attach the actively-edited row across the rebuild. Keep the existing clear-and-rebuild strategy for every other case.

## Acceptance criteria

- [x] Starting a rename, then triggering a background pin addition (e.g. via an in-progress import) no longer destroys the focused rename input or its in-progress edit. *(Runtime-only to fully confirm; by construction: `renameActive` is set true before the input enters the DOM, so any store `notify()` during the rename routes through `requestRender()` and merely sets `renderPending` instead of rebuilding.)*
- [x] The deferred/preserved row correctly re-renders (including any newly-added pins elsewhere in the list) once the rename is blurred or committed. *(Runtime-only to fully confirm; by construction: commit path clears `renameActive` before `updatePin`, so its notify rebuilds immediately; cancel/no-op path calls `renderNow()` when `renderPending`. Both re-pull `listPins()`/`listGroups()` fresh, so newly-imported pins appear.)*
- [x] No regression to the normal (no rename in progress) full-rebuild render path — new pins from search/import still appear promptly when nothing is being edited. *(When `renameActive` is false, `requestRender()` calls `renderNow()` synchronously — identical to the previous direct `render()` call.)*
- [x] `node --check` passes on all changed modules. *(`node --check js/pin-list.js` → clean.)*
- [ ] No errors in the browser console. *(Runtime-only; requires loading the app in a browser — not verifiable statically. Fix authorized fix-blind.)*

## Files affected

```
~ js/pin-list.js
```

## Notes

Review id: F10. Thirteenth in the strict fix order (see `tmp/confirmed-findings.md`); no same-file predecessor. Note: originally flagged needs-review; user authorized fix-blind on 2026-07-18. Keep the change conservative. Filed from a coordinator-verified full-app review, 2026-07-18.
