# FBL-018: Blank-name rows are silently dropped from import, uncounted

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-018`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Nit`                                       |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | `FBL-017` (same file: `js/import-foreign.js`) |

## Summary

Rows with a blank/missing name are dropped before the confirm dialog and completion summary tally their counts, in both the CSV and JSON import paths. The user sees a smaller "Add N new pins" / "Imported N" number than the file's row count, with zero indication that anything was skipped or why.

## Context

**Files:** `js/import-foreign.js`

- `js/import-foreign.js:233-234` — CSV path: `if (!rowName) continue`, dropping the row before it's counted.
- `js/import-foreign.js:98` and `js/import-foreign.js:107` — JSON path filters with the same uncounted-drop behavior.

## Failure scenario

A 100-row file has 12 rows with blank names. The confirm dialog says "Add 88 new pins," and the final summary says "Imported 88" — with no mention anywhere of the 12 rows that were silently skipped, leaving the user unable to tell whether that's expected or a bug in their file.

## Fix direction

Count skipped blank-name rows and mention them in the completion summary, parallel to how un-geocodable names are already reported (per CLAUDE.md's "never silently swallow" error-handling convention).

## Acceptance criteria

- [x] Importing a file with blank-name rows reports the count of skipped blank-name rows in the completion summary (and/or the confirm dialog), parallel to the existing un-geocodable-names reporting. — `showSummary` appends `Skipped N row(s) with no name.` when `skippedBlank > 0`; count is tallied in all three parse paths (CSV loop, JSON string-array, JSON object-array) and plumbed through `applyRows`.
- [x] A file with no blank-name rows shows no change in the summary text (no regression to the common case). — the new line is guarded by `if (skippedBlank > 0)`, so a clean file yields the identical `Imported N pins.` message.
- [x] No regression to the row-count semantics of the confirm dialog for the surviving rows. — confirm still reads `rows.length`, which now contains only surviving (non-blank) rows exactly as before; blank rows never entered `rows` previously either.
- [x] `node --check` passes on all changed modules. — verified on `js/import-foreign.js` (only changed module).
- [ ] No errors in the browser console. — runtime-only; not verifiable statically. Requires opening the app and importing a file with blank-name rows.

## Files affected

```
~ js/import-foreign.js
```

## Notes

Review id: F13. Must land after FBL-017 — same file (`js/import-foreign.js`). Filed from a coordinator-verified full-app review, 2026-07-18.
