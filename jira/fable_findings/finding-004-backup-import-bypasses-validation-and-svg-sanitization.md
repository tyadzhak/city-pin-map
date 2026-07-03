# FBL-004: Backup import applies unvalidated data — user icons bypass SVG sanitization, pins/groups bypass shape checks

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-004`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Medium` (defense-in-depth security + robustness) |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | None (pairs with FBL-002)                   |

## Summary

`importFromJson()` validates only that `pins`, `groups`, and (v2) `userIcons` are arrays, then feeds their contents verbatim into the stores via `replaceAll()`. Two consequences:

1. **Sanitization bypass:** `svg-ingest.js`'s allowlist sanitizer only guards the icon-picker upload path. A backup file's `userIcons[].fillSvg` is stored, persisted, re-exported, and rendered without ever passing through `ingestSvg()`. Today every render of that markup goes through `<img src="data:image/svg+xml,...">`, where scripts don't execute — so this is not currently exploitable XSS — but the sanitizer's guarantee ("everything in the user-icon store is allowlist-clean") is silently false, and any future change that inlines icon SVG into the DOM (a tempting refactor for CSS tinting) becomes an instant stored-XSS. Malformed `fillSvg` also triggers FBL-002's render-killing failure.
2. **Shape bypass:** pins with missing/non-numeric `lat`/`lon`, missing `id`, or non-string `name` enter the store unchecked. `pinsToFeatureCollection()` then emits GeoJSON with `undefined`/`NaN` coordinates (MapLibre drops or misplaces those features), duplicate/missing `id`s break drag and per-row operations, and the corrupt shapes get written back to `localStorage`, outliving the import.

## Context

**File:** `js/backup.js`, lines 105–133 — the only per-field checks are `Array.isArray(parsed.pins)`, `Array.isArray(parsed.groups)`, `Array.isArray(parsed.userIcons)`; then `groupStore.replaceAll(parsed.groups)`, `pinStore.replaceAll(parsed.pins)`, `userIconStore.replaceAll(parsed.userIcons)`.

**Contrast with:** `js/import-foreign.js` (PO-004), which carefully validates/clamps foreign coordinates (`parseCoord`, `hasValidCoords`) — the app's own backup path is currently the *less* defended of the two import paths, even though backups are just as likely to be hand-edited, truncated by a sync service, or produced by a different app version.

CLAUDE.md's invariants section says stores must "never crash on stale references" — imported data is the canonical source of stale/foreign references, and the load-from-localStorage path (`loadPins()` in `storage.js`) has the same trust assumption, so fixing validation at the import boundary (and optionally at hydrate) closes the main entry point.

Threat model note: this is a local, personal app; the realistic scenario is not an attacker but a *shared or mangled backup file* (e-mail round-trip, older version, hand edit). That's why severity is Medium rather than High.

## Steps to reproduce

**Sanitization bypass:**
1. Create a file `evil.json`:
   ```json
   { "version": 2, "pins": [], "groups": [],
     "userIcons": [{ "id": "x", "name": "x", "tintable": true,
       "fillSvg": "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'><script>alert(2)</script></svg>",
       "attribution": null, "createdAt": 1 }] }
   ```
2. Side panel → Import JSON → pick `evil.json` → confirm.
3. **Observed:** the icon (with `<script>` and `onload=` intact) is stored in `city-pin-map.user-icons.v1` and appears in the picker grid. The same markup pasted into the add-icon textarea is rejected by `ingestSvg`.
4. **Expected:** import rejects (or strips) markup the sanitizer would reject.

**Shape bypass:**
1. Import `{ "version": 2, "pins": [{ "name": "Ghost" }], "groups": [], "userIcons": [] }`.
2. **Observed:** a pin with `lat: undefined`, no `id`, appears in the side list; map behavior is undefined; the broken pin persists to storage.

## Acceptance criteria

- [x] On import, every `userIcons[].fillSvg` is passed through `ingestSvg()`; entries that fail are dropped with a user-visible summary (banner or alert) naming how many were skipped.
- [x] On import, pins are normalized: entries without finite in-range `lat`/`lon` or a non-empty string `name` are dropped (counted in the summary); missing `id`/`createdAt` are regenerated; `color` falls back to `DEFAULT_PIN_COLOR`; `group`/`icon` coerce to `null` when not strings.
- [x] Groups get the equivalent treatment (string `name`, hex `color` fallback, regenerated `id`/`createdAt` when missing).
- [x] A fully valid v1 and v2 backup imports byte-identically to today's behavior (no false rejections).
- [x] The import summary never silently swallows dropped entries (CLAUDE.md error-handling convention).
- [x] No regressions in HARDEN-001 / PIL-001 export-import round-trips.
- [x] No errors in browser console.

## Files affected

```
~ js/backup.js
```

## Out of scope

- Hardening the direct `localStorage` hydrate path (`loadPins` et al.) — worth a follow-up, but the import boundary is where foreign bytes enter.
- Render-side fault tolerance for bad sprites (FBL-002 — do that regardless).
- Re-sanitizing icons already sitting in a user's store from a past import.

## Implementation prompt

> Paste into a coding agent:

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md.

Task: Validate and normalize backup contents in js/backup.js importFromJson() before replaceAll().

Requirements:
- Add small pure normalizers (normalizePins, normalizeGroups, normalizeUserIcons) in backup.js.
- Pins: require finite lat in [-90,90], finite lon in [-180,180], non-empty string name; regenerate id (crypto.randomUUID) and createdAt (Date.now) when missing/invalid; default color to DEFAULT_PIN_COLOR from pins.js; coerce group/icon to string-or-null.
- Groups: non-empty string name, /^#[0-9a-fA-F]{6}$/ color with fallback, regenerate id/createdAt when missing.
- User icons: run fillSvg through ingestSvg() from js/svg-ingest.js; on failure drop the entry; use the sanitized markup on success; coerce tintable to Boolean; keep attribution shape { artistName, sourceUrl } | null.
- Track dropped counts per category and report them in one showError()/alert after the import completes. Import proceeds with the surviving entries.
- Keep the v1 path (userIcons untouched) exactly as-is.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Do not change the export format or the confirm-dialog flows.

Verification:
- The two repro files above: the evil icon is dropped (or sanitized) with a report; the Ghost pin is dropped with a report.
- A round-trip (Export JSON → Import JSON) of a healthy dataset changes nothing.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Found during a full-codebase correctness review (2026-07-03). Not currently exploitable as XSS because all icon rendering paths use `<img>`/data-URI (scripts inert); filed at Medium as a violated-invariant + robustness issue with a short path to becoming High if rendering ever changes.
