# FBL-022: Unreadable SVG file drop fails silently (no `.catch`)

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-022`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | None                                        |

## Summary

The file-drop handler in the icon picker's add-icon flow calls `file.text().then(...)` with no `.catch`, unlike the type-check error path immediately above it which does surface a message. If the promise rejects (e.g. the dropped file was moved, deleted, or is unreadable due to permissions between drop and read), the rejection goes unhandled: no preview appears, no error is shown, and the user has no idea anything went wrong. This directly contradicts CLAUDE.md's "never silently swallow" error-handling convention.

## Context

**Files:** `js/icon-picker.js`

- `js/icon-picker.js:474-477` — `file.text().then(...)` with no `.catch`.
- `js/icon-picker.js:467-473` — contrast: the type-check error path just above does write a message to the error element.

## Failure scenario

A user drops an SVG file that becomes unreadable between the drop event and the read (moved, deleted, or permission-denied). The `.text()` promise rejects with no handler attached — no preview renders, no error message appears, and the UI simply does nothing, leaving the user to assume the drop didn't register at all.

## Fix direction

Add a `.catch` to the `file.text()` chain that writes a message to the existing error element, mirroring the wording style of the adjacent "Drop an .svg file." message.

## Acceptance criteria

- [x] A dropped file that fails to read (simulated rejection of `file.text()`) surfaces a visible error message in the icon-picker's error element, matching the style of the existing type-check error message. _(Code path added: the `await file.text()` is wrapped in try/catch; the catch writes "Could not read that file. Try again." to `errorEl`. Runtime confirmation of the on-screen message requires a browser.)_
- [x] A successful drop-and-read of a valid SVG file is unaffected — no regression to the preview/sanitize flow. _(Success path is byte-for-byte equivalent: `textarea.value = text; runIngest(text)` still runs when the read resolves; only the failure branch is new. Full runtime verification requires a browser.)_
- [x] `node --check` passes on all changed modules. _(Verified: `node --check js/icon-picker.js` exits clean.)_
- [ ] No errors in the browser console. _(Runtime-only — not verifiable in this no-browser environment.)_

## Files affected

```
~ js/icon-picker.js
```

## Notes

Review id: F11. Fourteenth in the strict fix order (see `tmp/confirmed-findings.md`); no same-file predecessor. Filed from a coordinator-verified full-app review, 2026-07-18.
