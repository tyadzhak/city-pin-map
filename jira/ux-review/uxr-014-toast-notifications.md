# UXR-014: Errors cover the header, appear twice, and use blocking alerts

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-014`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Medium`                                    |
| **Priority**    | `Medium`                                    |
| **Depends on**  | None (foundation for UXR-004, UXR-015)      |

## Summary

Failures were shown in a red full-width `#error-banner` pinned over the header: it covered the header toggles, had no close button, and was red even for neutral messages. A search failure appeared twice (inline dropdown row and banner), and the import summary used a blocking `alert()`.

## Context

**Files:** `js/toast.js` (new), `js/storage.js`, `js/import-foreign.js`, `js/search.js`, `js/app.js`, `index.html`, `css/styles.css`, tests.

## Failure scenario

The user searches while offline: the inline row says "Geocoder returned an error" and an identical banner covers the "Show route" and basemap controls for 6 seconds with no way to dismiss it. Importing a CSV ends in a modal browser alert.

## Fix direction

- New `js/toast.js`: `showToast(message, { type: "info"|"success"|"error", action: { label, onClick }, duration })` returning `{ dismiss }`. Toasts stack bottom-center inside `.app-map`, have a close button, `role="alert"` (error) / `role="status"` (others), pause auto-dismiss on hover, default 5 s (10 s for errors or toasts with an action; `duration: 0` is sticky). DOM-only, so never exported. `setToastSink()` is a test seam.
- `showError(message)` keeps its signature and delegates to an error toast. `#error-banner` and its CSS removed.
- Search failure: inline dropdown row only.
- Import summary: toast (error if nothing imported, success if clean, otherwise info).
- Zero-pin "Apply to all pins" feedback is now an info toast.
- Tests: `js/test-helpers.mjs` records toasts and mirrors error toasts into a fake `#error-banner`; storage/search/import-foreign tests adjusted; new `js/toast.test.mjs`; the browser scenario's banner check now reads `.toast`.

## Acceptance criteria

- [x] No banner over the header. *(`#error-banner` removed; toasts live in `.app-map`.)*
- [x] Toasts have close buttons and correct types. *(Covered in `toast.test.mjs`.)*
- [x] No duplicate search error. *(`search.test.mjs` asserts no toast on HTTP error.)*
- [x] No `alert()` remains. *(grep of `js/`.)*
- [x] `showToast` is exported for later findings.
- [x] Node tests pass. *(433 pass, 0 fail.)*

## Files affected

```
+ js/toast.js
+ js/toast.test.mjs
~ js/storage.js, js/import-foreign.js, js/search.js, js/app.js
~ index.html, css/styles.css
~ js/test-helpers.mjs, js/storage.test.mjs, js/search.test.mjs, js/import-foreign.test.mjs
~ test/coverage/scenarios/00-boot-and-broad.mjs
```
