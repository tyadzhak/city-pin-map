# FBL-026: One-shot color migration only recognizes the literal DEFAULT_PIN_COLOR

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-026`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `High`                                      |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

The pin-color-precedence flip's one-shot migration (`normalizeLoadedPinColor(raw, { migrateLegacyDefault: true })`) treated a stored color as "never customized" (`null`, inherit) only when it was exactly `DEFAULT_PIN_COLOR` (`#e63946`). Before the flip, though, the add paths stamped `loadDefaultPin().color` — the user's configurable Design-tab default-pin color — and "Apply to all pins" stamped that same color onto every pin. A user whose default was, say, blue `#1d3557` therefore has untouched pins carrying blue; after upgrading, nothing migrated them.

## Context

**Files:** `js/storage.js`, `js/backup.js`

- `js/storage.js` — `normalizeLoadedPinColor()` only compared against `DEFAULT_PIN_COLOR`; its array-level caller `normalizeLoadedPins()` (used by `loadPins()` and `loadSnapshot()`) and `js/backup.js`'s `normalizePins()` (v1/v2 import) all opted in without knowing the saved default.
- Pre-flip stamping sites: `js/search.js` `selectResult()`, `js/import-foreign.js` `applyRows()`, and the Design tab's "Apply to all pins".

## Failure scenario

User set the default-pin color to blue pre-flip and added pins. After upgrading, those pins are classed as customized: grouped ones stop showing their group's color, and later edits to the default color never recolor them.

## Fix

While (and only while) migration is opted in, a stored color equal (case-insensitively) to the CURRENT saved default-pin color also becomes `null`.

- `normalizeLoadedPinColor` gained an optional `customDefaultColor` option, consulted only when `migrateLegacyDefault` is true.
- The default is read ONCE per migration pass (`loadDefaultPin().color`), never per pin: inside `normalizeLoadedPins()` (live first-load + v1 snapshot Load) and inside `normalizePins()` in `js/backup.js` (v1/v2 import). Non-migrating reads never touch the default-pin key. The one-shot marker semantics are unchanged.
- Accepted trade-off (documented in the code comment): a pin deliberately set, pre-flip, to exactly the user's default color also becomes inherit — the same class of guess the red heuristic already makes. For a backup import, the "current default" is the importing browser's saved default.

## Acceptance criteria

- [x] With the default-pin key set to blue, the first-load migration turns blue pins into `null`; other concrete colors and the literal red behave as before. *(`loadPins: first load with a custom default-pin color…`)*
- [x] Without a default-pin key, behavior is unchanged. *(`loadPins: without a saved default-pin key…`)*
- [x] After the marker is set, blue pins pass through verbatim (one-shot). *(`loadPins: once the migration marker is set…`)*
- [x] A v1/v2 backup import honors the same rule; v3 stays verbatim. *(`importFromJson: a v1/v2 backup also migrates…`)*
- [x] A v1 snapshot Load honors the same rule; a v2 snapshot does not. *(`loadSnapshot: a version-1 snapshot also migrates…`)*
- [x] Comparison is case-insensitive. *(`normalizeLoadedPinColor: customDefaultColor migrates…`)*
- [x] Default read once per pass, not per pin; a corrupt default key degrades to red-only without throwing. *(`…reads the default-pin key once per pass…`, `…corrupt default-pin key…`)*
- [x] `node --check` passes on changed modules; `node --test js/*.test.mjs` passes.

## Files affected

```
~ js/storage.js
~ js/backup.js
~ js/storage.test.mjs
~ js/backup.test.mjs
+ jira/fable_findings/finding-026-color-migration-misses-custom-default.md
```

## Notes

Pure logic, covered by node unit tests; no runtime-only verification needed.
