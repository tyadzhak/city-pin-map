# FBL-034: Foreign-JSON row with a null name is imported as a pin literally named "null"

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-034`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

`rowFromObject` in the PO-004 foreign-JSON import coerced the name with `String(obj[nameKey]).trim()`. `String(null)` is `"null"` (and an object becomes `"[object Object]"`), both non-empty, so a row such as `{"name": null, "lat": 10, "lon": 20}` passed the blank-name filter and was pinned (or geocoded) under the literal name "null" instead of being counted as a skipped-blank row.

## Context

**Files:** `js/import-foreign.js`, `js/import-foreign.test.mjs`

- `js/import-foreign.js` `rowFromObject` — the `String(obj[nameKey]).trim()` coercion.
- The blank-name filter and `skippedBlank` count in `parseJsonImport` only see `row.name.length > 0`, so the literal string defeated them.
- The CSV path (`parseCsvImport`) is not affected: cells are always strings and a missing cell goes through `cols[nameIdx] ?? ""`.
- The bare-string-array path is not affected: its shape check (`every(item => typeof item === "string")`) guarantees strings before `.trim()`.

## Failure scenario

Importing `[{"name": null, "lat": 10, "lon": 20}]` creates a pin named "null" at (10, 20), with no "skipped" feedback, instead of reporting the row as having no name.

## Fix direction

Coerce the name through a small helper that returns the trimmed string for strings, numbers and booleans, and `""` for everything else (null, undefined, objects, arrays), so non-name values fall into the existing skipped-blank accounting.

## Acceptance criteria

- [x] A `null` name is counted as skipped-blank and not pinned. *(`nameToString()` returns `""` for non-primitive/nullish values; test "a null name is skipped as blank, not pinned as 'null'" asserts one pin and the "Skipped 1 row with no name." summary.)*
- [x] Object- and array-valued names are skipped-blank rather than becoming "[object Object]". *(Covered by "an object- or array-valued name is skipped as blank"; summary reports 2 skipped.)*
- [x] A missing or undefined name never produces an "undefined" pin. *(JSON cannot encode `undefined`; an element with no name key makes shape detection reject the whole file, and `nameToString` also returns `""` for `undefined`. Covered by "an element missing the name key makes the shape unrecognised, pinning nothing".)*
- [x] Numeric names still import as before, and normal string names are unchanged. *(Tests "a numeric name is still imported as its string form" and "a normal string name is trimmed and imported unchanged".)*
- [x] The CSV and bare-string-array paths are checked for the same bug. *(Neither is affected — see Context; no change needed.)*
- [x] `node --check` passes on all changed modules. *(`js/import-foreign.js` and `js/import-foreign.test.mjs` clean.)*
- [x] `node --test` passes. *(`js/import-foreign.test.mjs`: 35/35, including 6 new cases.)*

## Files affected

```
~ js/import-foreign.js
~ js/import-foreign.test.mjs
+ jira/fable_findings/finding-034-import-null-name-becomes-literal.md
```

## Notes

Pure logic, covered by unit tests; nothing runtime-only to verify. Booleans keep stringifying as before (`true` becomes the name "true") to avoid widening the change beyond the reported defect.
