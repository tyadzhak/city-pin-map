# FBL-028: Snapshot Load can leave persisted data half-replaced

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-028`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `High`                                      |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

The Save / Load / New snapshot's Load handler replaced the group store and then the pin store with no all-or-nothing persistence step. Each store saves through its own storage subscriber, so a quota failure on the second write leaves disk holding the snapshot's groups next to the pre-Load pins. The backup import already solves this with FBL-016's `prewriteImportPayloads()`; Load did not use it.

## Context

**Files:** `js/app.js`, `js/storage.js` (read-only reference), `js/backup.js` (reference usage)

- `js/app.js` — `initSnapshotControls()`'s Load handler called `groupStore.replaceAll(snapshot.groups)` then `pinStore.replaceAll(snapshot.pins)` directly.
- `js/storage.js` — `prewriteImportPayloads({ pins, groups, userIcons })` writes the pins and groups keys (and the icon key when `userIcons != null`) up front and rolls back every written key on any failure, returning a boolean.
- `js/backup.js` — the import path calls it after confirm and before any `replaceAll`, and shows a red-banner error on `false`.

## Failure scenario

Large custom icons plus the snapshot copy itself fill `localStorage`. The user clicks Load and confirms. The groups write succeeds, the pins write hits `QuotaExceededError`, and `savePins` shows "kept in memory only". The session looks fully loaded. On reload the disk holds the snapshot's groups and the old pins, whose group ids no longer exist, so every pin shows as ungrouped.

## Fix direction

After the confirm, and before touching either store, call `prewriteImportPayloads({ pins, groups, userIcons: null })`. On `false`, abort with a `showError()` banner and leave both stores untouched. On success keep the groups-then-pins `replaceAll` order and the existing success message.

## Acceptance criteria

- [x] Load pre-writes pins and groups atomically before mutating either store. *(`prewriteImportPayloads` is called with the already-normalized `snapshot.pins`/`snapshot.groups` returned by `loadSnapshot()`, matching the argument shape `js/backup.js` passes; `userIcons: null` so the icon key is skipped.)*
- [x] On pre-write failure, the Load is aborted, a red `showError()` banner explains it, and neither store changes. *(Early `return` before both `replaceAll` calls. Disk is restored by the helper's own rollback. Runtime-only to fully confirm with a stubbed quota error.)*
- [x] The pre-write runs after the confirm, so a cancelled confirm writes nothing. *(The call sits after the `confirm()` block; the cancel path still returns first with no message.)*
- [x] Existing flow is unchanged: snapshot parsed first, confirm only when current pins OR groups are non-zero, groups-then-pins `replaceAll` order, dropped-entry counts folded into one banner, success status message. *(Only a new block was inserted between the confirm and the `replaceAll` calls.)*
- [x] `js/storage.js` is unchanged. *(`prewriteImportPayloads` already serves this case.)*
- [x] `node --check js/app.js` passes and `node --test js/*.test.mjs` passes.
- [ ] No errors in the browser console and the quota scenario behaves as described. *(Runtime-only; to be confirmed by a headless-browser run.)*

## Files affected

```
~ js/app.js
+ jira/fable_findings/finding-028-snapshot-load-non-atomic-persist.md
```

## Notes

Filed from the full-app review. The same non-atomic pattern does not apply to New, which clears both stores to empty arrays (smaller payloads that can't newly exceed quota).
