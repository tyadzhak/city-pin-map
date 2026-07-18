# FBL-023: Namespace-prefixed `href` bypasses `SAFE_HREF_RE` in SVG sanitization (latent)

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-023`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Nit`                                       |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | None                                        |

## Summary

`js/svg-ingest.js`'s href value check (`SAFE_HREF_RE`) fires only when the attribute's exact name is `href` or `xlink:href`. Any other namespace prefix (e.g. `x:href` with `xmlns:x` declared on the element) falls through to the local-part allowlist check instead — and local part `href` IS allowlisted — so a value like `x:href="javascript:..."` passes sanitization untouched. `on*` handlers are not affected by this specific bypass. There is no active DOM sink today (icon markup renders via `<img src="data:image/svg+xml,...">`, where scripts and `javascript:` hrefs are inert), so this is a control-hardening fix rather than an active exploit — but it is nonetheless a real gap in the sanitizer's stated allowlist guarantee.

## Context

**Files:** `js/svg-ingest.js`

- `js/svg-ingest.js:124-146` — the href value check (`SAFE_HREF_RE`) is applied only for attributes named exactly `href`/`xlink:href`; any other `*:href` prefix falls to the local-part allowlist check, and local part `href` is itself allowlisted, so the value check is skipped entirely for prefixed variants.

## Failure scenario

A crafted SVG containing `x:href="javascript:..."` (with `xmlns:x` declared) survives sanitization and is stored/exported in backups as "sanitizer-clean" markup. It is not exploitable today (no active href-consuming DOM sink), but becomes exploitable the moment any future change adds an href-active element or an inline-DOM render sink for user-icon SVG — at which point this gap would already be sitting in every existing user's stored icon library.

## Fix direction

Normalize the attribute name to its local part (i.e. strip any namespace prefix before the colon) BEFORE deciding whether it's an `href`-family attribute, so that any `*:href` variant routes through `SAFE_HREF_RE`'s value check rather than only the bare local-part allowlist. Add a test case for the prefixed-href rejection.

## Acceptance criteria

- [x] An SVG with a namespace-prefixed `href` carrying an unsafe value (e.g. `x:href="javascript:alert(1)"` with `xmlns:x` declared) is rejected/stripped by `ingestSvg()`, matching the treatment already given to bare `href`/`xlink:href`.
- [x] Legitimate namespace-prefixed attributes unrelated to `href` (and safe `href`/`xlink:href` values, e.g. `#fragment` references) continue to pass sanitization — no regression to the existing allowlist behavior for Heroicons-shaped uploads.
- [x] A new test case covering the prefixed-href rejection is added to `js/svg-ingest.test.mjs`.
- [x] `node --test js/svg-ingest.test.mjs` passes.
- [x] `node --check` passes on all changed modules.
- [x] No errors in the browser console.

## Files affected

```
~ js/svg-ingest.js
~ js/svg-ingest.test.mjs
```

## Notes

Review id: F15. Last in the strict fix order (see `tmp/confirmed-findings.md`); no same-file predecessor. Filed from a coordinator-verified full-app review, 2026-07-18.
