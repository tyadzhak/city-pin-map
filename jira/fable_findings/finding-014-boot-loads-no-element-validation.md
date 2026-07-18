# FBL-014: Boot-time pin/group/icon loads apply no element-level validation — a `null` pin bricks init()

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-014`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `High`                                      |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | None                                        |

## Summary

`loadPins`, `loadGroups`, and `loadUserIcons` in `js/storage.js` validate only that the top-level value is an array — individual elements pass through verbatim. `pin-list.js` sorts pins with `a.createdAt - b.createdAt`; a `null` element throws a `TypeError` out of `initPinList`, which aborts the whole of `app.js`'s `init()` — side panel, search, export, and settings never wire up. Separately, `map.js` emits invalid GeoJSON for string/null coordinates; MapLibre silently drops the feature, and `savePins` re-persists the bad element forever (a silent, permanent ghost pin).

## Context

**Files:** `js/storage.js`

- `js/storage.js:97-116` — `loadPins` validates only `Array.isArray`.
- `js/storage.js:133-152` — `loadGroups` validates only `Array.isArray`.
- `js/storage.js:168-187` — `loadUserIcons` validates only `Array.isArray`.
- `js/pin-list.js:66` — sorts with `a.createdAt - b.createdAt`; a `null` element throws `TypeError`, aborting `initPinList` and therefore all of `app.js`'s `init()`.
- `js/map.js:1011` — emits invalid GeoJSON for string/null coordinates; MapLibre silently drops the feature while `savePins` re-persists it.

## Failure scenario

`city-pin-map.pins.v1` contains `[{good pin}, null]` (e.g. from a truncated write or a hand edit). On every reload, the app is completely dead — no recovery path, no error surfaced (the crash happens deep inside `init()`, past where the top-level try/catch banners are wired). Variant: a pin with `lat: "48.8"` (string, not number) shows in the side list but is invisible on the map, and gets re-persisted verbatim on every save.

## Fix direction

Filter/normalize elements at load time the way `backup.js`'s normalizers already do for the import path (FBL-004/FBL-016 precedent): drop non-object elements, coerce or drop non-finite/out-of-range coordinates, default missing color/regenerate missing ids sensibly. Keep the existing structural-corruption banner behavior for the top-level "not an array" case.

## Acceptance criteria

- [x] A `city-pin-map.pins.v1` value containing a `null` (or otherwise malformed) element no longer crashes `init()` — the app boots normally with the malformed element dropped and a visible message naming what was dropped. *(Static: `normalizeLoadedPins` drops non-object entries before they reach the store, so `pin-list.js`'s `a.createdAt` sort never sees a `null`; `reportLoadDropped` surfaces a banner naming "pin". End-to-end no-crash boot is runtime-only — see notes.)*
- [x] A pin with non-numeric/out-of-range `lat`/`lon` is dropped (or coerced) at load time rather than silently re-persisted as an invisible ghost pin. *(`toFiniteNumber` coerces string coords; the range check drops non-finite / out-of-range values — mirrors `backup.js`.)*
- [x] `loadGroups`/`loadUserIcons` get the equivalent per-element treatment. *(`normalizeLoadedGroups` / `normalizeLoadedUserIcons` added; both drop non-objects and default/repair fields.)*
- [x] A fully valid, well-formed `pins`/`groups`/`userIcons` payload loads byte-identically to today's behavior (no false rejections). *(Every data-model field round-trips unchanged for healthy entries; only unknown/extra keys are dropped — same as the backup normalizers.)*
- [x] No regression to the existing top-level structural-corruption banner (`Array.isArray` failure case). *(The `Array.isArray` throw + corrupt-load `catch`/`showError` paths are untouched; normalization runs only after the array check passes.)*
- [x] `node --check` passes on all changed modules. *(`node --check js/storage.js` — clean.)*
- [ ] No errors in the browser console. *(Runtime-only — not exercised in this fix pass.)*

## Files affected

```
~ js/storage.js
```

## Notes

Review id: F4. Sixth in the strict fix order (see `tmp/confirmed-findings.md`) — first finding to touch `js/storage.js`; FBL-015 (F9) touches the same file and must land after this one. Filed from a coordinator-verified full-app review, 2026-07-18.

### Implementation notes (fix, 2026-07-18)

- **Kept `storage.js` self-contained** rather than sharing `backup.js`'s normalizers. `backup.js` already imports from `storage.js`, so importing back would form a cycle. Duplicating three small pure normalizers is the smaller, F4-scoped change (F4 owns only `js/storage.js`; touching `backup.js` belongs to F5). Added `normalizeLoadedPins` / `normalizeLoadedGroups` / `normalizeLoadedUserIcons` + `toFiniteNumber` + `normalizeLoadedAttribution`, modeled 1:1 on `backup.js`'s import-path normalizers. Each returns `{ items, dropped }`; the load functions call `reportLoadDropped(dropped, noun)` to surface one banner per store when anything was dropped.
- **`DEFAULT_PIN_COLOR` imported from `pins.js`** (cycle-free — `pins.js` imports nothing) so the color fallback stays a single source of truth, matching `backup.js`. `DEFAULT_GROUP_COLOR` / `HEX_COLOR_RE` are defined locally, mirroring `backup.js`.
- **Deviation — user icons are NOT re-run through `ingestSvg` at load.** `backup.js` re-sanitizes because a backup is foreign bytes; the localStorage user-icon store already passed sanitization on the way in, and re-sanitizing the whole library on every boot would put `svg-ingest` on the critical init path for no correctness gain. Instead, `normalizeLoadedUserIcons` drops entries whose `fillSvg` is missing/blank (the one irreparable field) and coerces the rest. This keeps the change conservative and off the boot-critical path.
- **Banner granularity:** one summary banner per load function (per store), not one global banner — the three loads run as separate `attach*` calls at different times, and `showError` uses a single shared banner element, so combining them would require restructuring outside F4's scope. This matches the existing per-load corrupt-load banners.
