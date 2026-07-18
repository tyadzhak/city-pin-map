# FBL-019: `\r`-only (classic-Mac) CSV line endings collapse to one row

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-019`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Nit`                                       |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | `FBL-018` (same file: `js/import-foreign.js`) |

## Summary

The CSV tokenizer unconditionally swallows a bare `\r` character without treating it as a row terminator. A file using classic-Mac-style `\r`-only line endings (no `\n`) collapses into a single giant row, since no row boundary is ever recognized.

## Context

**Files:** `js/import-foreign.js`

- `js/import-foreign.js:195-196` — a bare `\r` is unconditionally swallowed and never terminates a row.

## Failure scenario

A CSV file with `\r`-only line endings parses into one giant row. `table.slice(1)` (skipping the assumed header row) then yields an empty data set, and the user sees "No rows found in that file" for a file that actually has valid rows.

## Fix direction

Treat a `\r` not immediately followed by `\n` as a row terminator (i.e. support `\r`, `\n`, and `\r\n` as row-ending variants, matching the existing CRLF/LF handling already claimed in CLAUDE.md's description of this tokenizer).

## Acceptance criteria

- [x] A CSV file using `\r`-only line endings parses into the correct number of rows, matching the same file saved with `\n` or `\r\n` endings. (Verified via throwaway tokenizer test: `\n`, `\r\n`, and `\r`-only all yield the same 3 rows.)
- [x] Existing `\n` and `\r\n` handling is unaffected — no regression to the CRLF/LF parsing already in place. (Verified: no phantom empty rows for `\r\n`; `\r`/`\r\n` inside quoted fields still preserved as field content.)
- [x] `node --check` passes on all changed modules. (`node --check js/import-foreign.js` — clean.)
- [ ] No errors in the browser console. (Runtime-only — not verifiable from a static check; requires opening the app and importing a `\r`-only CSV.)

## Files affected

```
~ js/import-foreign.js
```

## Notes

Review id: F14. Must land after FBL-018 — same file (`js/import-foreign.js`). Filed from a coordinator-verified full-app review, 2026-07-18.
