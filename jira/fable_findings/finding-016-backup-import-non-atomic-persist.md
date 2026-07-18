# FBL-016: Backup import persists three stores non-atomically — quota failure silently loses part of the import

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-016`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed — fix-blind (originally needs-review)` |
| **Priority**    | `High`                                      |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | `FBL-015` (touches `js/storage.js`, if used) |

## Summary

`importFromJson()` calls `groupStore.replaceAll → pinStore.replaceAll → userIconStore.replaceAll` as three separate notify/persist cascades. `saveUserIcons` (the largest payload, since it can carry big icon SVGs) catches `setItem` failure and shows only a transient 6s banner without rethrowing. If the icon payload pushes storage over quota, groups and pins persist successfully but user icons don't — the in-memory state looks fully imported, but on reload the icons are gone and pins that reference them point at missing entries.

## Context

**Files:** `js/backup.js` (+ possibly a `js/storage.js` helper)

- `js/backup.js:146-150` — `groupStore.replaceAll` → `pinStore.replaceAll` → `userIconStore.replaceAll`, three separate persist cascades with no transactional grouping.
- `js/storage.js:189-198` — `saveUserIcons` (largest payload) catches `setItem` failure with a transient banner, no rethrow, no rollback of the already-persisted groups/pins.

## Failure scenario

A v2 backup with large icon SVGs pushes total storage usage over quota during import. Groups and pins persist; user icons do not. In-memory, everything looks correctly imported. On reload, the icon library is missing and pins that reference those icons silently fall back (per the existing stale-reference contract), but the user never explicitly lost data from their point of view — they just find it gone later.

## Fix direction

Treat import as a transaction: pre-serialize all three payloads and verify they can be written (or write and roll back all three stores to a pre-import snapshot on any single failure), and surface a persistent — not transient — error banner on failure so the user knows the import did not fully take. Keep the change conservative and localized to `js/backup.js` (touch `js/storage.js` only if a shared write-verification helper is genuinely needed).

## Acceptance criteria

- [x] A simulated quota failure during the `userIcons` persist step of an import either rolls back groups/pins to their pre-import state, or otherwise leaves all three stores consistent with each other after reload (no partial import silently accepted as "fully imported"). — Implemented via the PRE-VERIFY shape: `prewriteImportPayloads()` (js/storage.js) writes all three keys up front; on any failure it restores every key it already overwrote to its pre-attempt raw bytes and returns `false`, and `importFromJson` then aborts BEFORE any `replaceAll`, so all three stores stay untouched and mutually consistent. (Runtime quota simulation not executed here — guaranteed by the abort-before-mutate control flow.)
- [~] The user sees a persistent (not auto-dismissing) error when an import partially fails, distinct from the existing transient "kept in memory only" banner used elsewhere. — **Deviation, per coordinator fix direction:** uses `showError` (auto-hides after 6s) with an explicit "Import was NOT applied … does not fit in your browser's storage" message. The coordinator's PRE-VERIFY instruction explicitly accepts the auto-hiding banner; the load-bearing part is that the import is *fully aborted with stores untouched* (no partial import accepted), which is satisfied. A distinct persistent-banner mechanism was intentionally NOT built to keep the change conservative and localized.
- [x] A fully successful import (well within quota) behaves byte-identically to today. — Pre-write serializes `JSON.stringify(pins/groups/userIcons)`; the subsequent `replaceAll` fires each store's save subscriber, whose snapshot is the same array, rewriting identical bytes. Final on-disk + in-memory state is unchanged from today.
- [x] No regression to the v1/v2 backup format handling or the existing per-category drop-count summary (FBL-004). — Normalizers, the isV2 gate, and `reportDropped` are untouched; v1 passes `userIcons: null` so the user-icon key is neither pre-written nor replaced.
- [x] `node --check` passes on all changed modules. — `node --check` clean on js/storage.js and js/backup.js.
- [ ] No errors in the browser console. — Runtime-only; not verified in this fix-blind change.

## Files affected

```
~ js/backup.js
~ js/storage.js (only if a shared helper is needed)
```

## Notes

Review id: F5. Eighth in the strict fix order (see `tmp/confirmed-findings.md`); touches `js/storage.js` only if needed, after FBL-015 in that file. Note: originally flagged needs-review; user authorized fix-blind on 2026-07-18. Keep the change conservative. Filed from a coordinator-verified full-app review, 2026-07-18.
