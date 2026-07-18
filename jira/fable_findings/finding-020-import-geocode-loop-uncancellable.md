# FBL-020: Import geocode loop is uncancellable — no early abort during a systemic Nominatim outage

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-020`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | `FBL-019` (same file: `js/import-foreign.js`); may also touch `js/geocode.js` |

## Summary

The sequential geocode loop that resolves rows without valid coordinates has no abort signal, no outage heuristic, and no cancel affordance. At the mandatory ≥1 request/second rate gate, a large import during a Nominatim outage locks the user into watching a foregone-conclusion failure for the file's full row count, with the import button disabled throughout.

## Context

**Files:** `js/import-foreign.js`

- `js/import-foreign.js:264-290` — sequential geocode loop: no abort signal, per-row error capture, no consecutive-failure heuristic; ≥1s per row via the existing rate gate.
- `js/app.js:518-523` — the import button is disabled for the entire duration of the loop, with no way to interrupt it.

## Failure scenario

A 60-name import runs while Nominatim is down. The user is locked out for ~60 seconds watching a result they could have predicted after the first few failures, and the final summary reads "Imported 0 pins" — a full minute spent to learn nothing actionable sooner.

## Fix direction

Early-abort the geocode loop after N consecutive network-level failures, surfacing one clear banner naming how many rows were not attempted as a result. A full cancel button is optional scope; the consecutive-failure bail is the required part — keep scope minimal, touching `js/geocode.js` only if a signal for "this was a network-level failure vs. a legitimate not-found" is genuinely needed there.

## Acceptance criteria

- [x] A simulated systemic outage (e.g. Nominatim requests all failing at the network level) aborts the import loop after a small, fixed number of consecutive failures rather than running through every remaining row. *(Static: `applyRows` now tracks `consecutiveFailures`; after `CONSECUTIVE_FAILURE_LIMIT = 3` consecutive thrown failures from `searchCities` it records the remaining count as `notAttempted` and `break`s out of the loop. Runtime confirmation deferred — see note below.)*
- [x] The completion summary/banner clearly states how many rows were not attempted due to the early abort. *(Static: `showSummary` gained a `notAttempted` param and, when >0, appends "The geocoder appeared unreachable, so N remaining row(s) … not attempted." — a sentence distinct from the "Could not geocode N: …" per-row-failure sentence.)*
- [x] A normal import (occasional isolated not-found results, not a systemic outage) is unaffected — no premature abort on a handful of scattered failures. *(Static: `searchCities` returns `[]` for a real "no match" without throwing; the loop resets `consecutiveFailures = 0` on any successful round-trip (including `[]`) before the `!top` check, so scattered not-founds never increment the outage counter. Only thrown network-level failures count toward the bail.)*
- [x] No regression to the existing ≥1 req/sec rate gate or per-row error capture. *(Static: the loop still awaits `searchCities` per row — the rate gate lives in `geocode.js`, untouched — and still `push`es `{ name, reason }` to `failed` on every thrown error, including the 3 that trigger the bail.)*
- [x] `node --check` passes on all changed modules. *(Ran `node --check js/import-foreign.js` — clean, no output.)*
- [ ] No errors in the browser console. *(Runtime-only — not verifiable statically; requires driving an import in the browser. Deferred to the coordinator's runtime verification.)*

## Files affected

```
~ js/import-foreign.js
~ js/geocode.js (only if a network-failure signal is genuinely needed there)
```

## Notes

Review id: F12. Must land after FBL-019 — same file (`js/import-foreign.js`). Filed from a coordinator-verified full-app review, 2026-07-18.
