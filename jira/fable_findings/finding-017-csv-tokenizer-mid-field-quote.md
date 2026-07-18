# FBL-017: CSV tokenizer flips into quote-mode on any mid-field `"`

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-017`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | None                                        |

## Summary

The hand-rolled CSV tokenizer in `js/import-foreign.js` enters quote-mode whenever it sees a `"` outside an already-quoted field, at ANY position within the field — not just when the `"` is the first character. Per RFC4180, a quote is only special when it starts a field; a `"` appearing mid-field (e.g. an apostrophe-adjacent name like `O"Brien`) should be a literal character.

## Context

**Files:** `js/import-foreign.js`

- `js/import-foreign.js:190-191` — outside quotes, `c === '"'` sets `inQuotes = true` at any position within a field.
- `js/import-foreign.js:179-189` — subsequent commas/newlines get absorbed into the now-open quoted field.

## Failure scenario

A CSV row like `O"Brien City,40,-70` has its mid-field quote misinterpreted as an opening quote — the rest of the line (`,40,-70` and potentially subsequent lines) gets swallowed into one field, coordinates are lost, and the row is geocoded using a mangled name — resulting in a wrong pin or a reported "could not geocode" for a row that had perfectly good data.

## Fix direction

Enter quote-mode only when `"` is the first character of a field (i.e. immediately after a field-start position: start of row, or immediately after a comma/newline delimiter); otherwise treat `"` as a literal character within the field.

## Acceptance criteria

- [x] A row containing a mid-field `"` (e.g. `O"Brien City,40,-70`) parses into the correct three fields, with coordinates preserved and not absorbed into a runaway quoted field. (Verified via standalone tokenizer test — 3 fields, coords preserved.)
- [x] Properly RFC4180-quoted fields (field starting with `"`, embedded commas/newlines inside the quotes, escaped `""` for a literal quote) still parse correctly — no regression to the quoted-field path. (Verified via test: embedded-comma, embedded-newline, escaped `""`, empty and consecutive-empty quoted fields, CRLF all pass.)
- [x] `node --check` passes on all changed modules. (`node --check js/import-foreign.js` — clean.)
- [ ] No errors in the browser console. (Runtime-only — not exercised in-browser this session; change is localized to `tokenizeCsv` and syntax-clean.)

## Files affected

```
~ js/import-foreign.js
```

## Notes

Review id: F8. Ninth in the strict fix order (see `tmp/confirmed-findings.md`) — first finding to touch `js/import-foreign.js`; FBL-018/019/020 (F13/F14/F12) touch the same file and must land after this one, in that order. Filed from a coordinator-verified full-app review, 2026-07-18.
