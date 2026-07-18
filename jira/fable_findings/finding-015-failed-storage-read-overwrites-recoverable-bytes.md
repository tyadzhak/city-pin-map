# FBL-015: Failed/corrupt localStorage read returns `[]`, and the first mutation overwrites still-recoverable bytes

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-015`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor (suspected)`                         |
| **Confidence**  | `Confirmed — fix-blind (originally needs-review)` |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | `FBL-014` (same file: `js/storage.js`)      |

## Summary

When `getItem` throws, or the stored JSON is corrupt, the load functions in `js/storage.js` return `[]` and show a banner — but `attachStorage` hydrates the store with that `[]` and immediately subscribes the write-back path (`savePins`). The very next mutation (e.g. adding one pin) persists `[newPin]` over whatever bytes were actually on disk, even if the original data was transient-failure-recoverable or hand-fixable corrupt JSON.

## Context

**Files:** `js/storage.js` (fix after FBL-014, same file)

- `js/storage.js:101-105` — `getItem` throws → returns `[]` + banner.
- `js/storage.js:111-115` — corrupt JSON → returns `[]` + banner.
- `js/storage.js:460-463` — `attachStorage` hydrates the store with that `[]` and subscribes `savePins` immediately, with no distinction from a genuinely-empty key.

## Failure scenario

A transient read failure (or recoverable corrupt bytes a user could have hand-fixed, e.g. a truncated but mostly-intact JSON file) occurs on load. The user adds one pin. The original data — however recoverable it may have been — is now permanently overwritten by `[newPin]`.

## Fix direction

Distinguish "read failed / corrupt" from "key genuinely absent." After a failed read, either (a) suppress the write-back subscription until a successful read confirms genuine emptiness, or (b) stash the original raw bytes under a `.corrupt` backup key before the first overwrite so they remain recoverable.

## Acceptance criteria

- [x] A corrupt (but present) `localStorage` value is not silently overwritten by the first subsequent mutation — the original raw bytes are stashed under a sibling `<key>.corrupt` key before the empty-hydrate + first mutation can overwrite them (`stashCorruptValue`, called in each array store's corrupt-JSON catch before returning `[]`).
- [x] The existing corruption banner still fires and is not weakened — the base message is unchanged and, when the stash succeeds, is *extended* with the recovery key (`corruptBannerMessage`); banner never suppressed.
- [x] A genuinely-absent key (first-ever run, or user cleared storage) still initializes to `[]` and behaves exactly as today — the `raw === null` early-return path is untouched; the stash lives only in the corrupt-JSON catch, which is unreachable for an absent key.
- [x] No regression to the normal load/hydrate/save cycle for well-formed data — only the corrupt-JSON catch blocks changed; the success path, `attachStorage`/`attachGroupStorage`/`attachUserIconStorage` contracts, and the getItem-throws path are all unchanged.
- [x] `node --check` passes on all changed modules — `node --check js/storage.js` clean (only module touched).
- [ ] No errors in the browser console. *(Runtime-only — not verified in this fix-blind pass; no console-touching code paths were altered.)*

## Files affected

```
~ js/storage.js
```

## Notes

Review id: F9. Must land after FBL-014 — same file (`js/storage.js`). Note: originally flagged needs-review; user authorized fix-blind on 2026-07-18. Keep the change conservative. Filed from a coordinator-verified full-app review, 2026-07-18.
