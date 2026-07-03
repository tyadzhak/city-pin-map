# FBL-002: A single failing icon sprite permanently blocks ALL pin and route rendering

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-002`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Medium` (High user impact, low likelihood) |
| **Priority**    | `High`                                      |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | None                                        |

## Summary

`loadPinIconImages()` loads all icon sprites with `Promise.all`, and both call sites treat any single rejection as fatal: `addPinAndRouteLayers()` shows an error banner and returns **before adding the pins source, pins layer, labels layer, and route layer**. One user icon whose `fillSvg` fails to decode as an image makes every pin on the map disappear — and stay gone, because every subsequent `styledata` cycle retries the same failing load. There is no per-icon isolation and no recovery path short of the user hand-editing `localStorage`.

## Context

**File:** `js/map.js`

- `loadPinIconImages()` — lines 883–893: `Promise.all` over `fetchImage()` calls; first rejection rejects the whole batch (already-resolved images do land in the `pinIconImages` cache, but the caller can't tell which).
- `addPinAndRouteLayers()` — lines 915–929: `catch (err) { showError(...); return; }` aborts layer setup entirely. This runs on initial `load` and after every basemap swap (`setMapStyle` → `onSuccess`), so the failure is permanent for the session.
- Icon-registry subscription in `initMap()` — lines 471–479: same pattern (`showError` + `return`), so adding one bad icon also skips re-registering all *other* new icons.

How a bad sprite gets into the registry:

- A v2 backup import (`js/backup.js`) restores `userIcons` verbatim with **no re-validation** (see FBL-004) — a hand-edited or corrupted backup can carry a `fillSvg` that `new Image()` cannot decode.
- A hand-edited `city-pin-map.user-icons.v1` localStorage key.
- A built-in icon's `src` failing to load (e.g. `assets/icons/circle.svg` missing after a bad deploy) — in that case even a fresh profile renders no pins.

The failure contradicts the codebase invariant "render must never crash on stale data" (CLAUDE.md → Pin data model): the stale/corrupt entity here is an icon rather than a group, but the blast radius is far larger than the equivalent group-handling contract allows.

## Steps to reproduce

1. Open the app with at least one pin.
2. In DevTools, run:
   ```js
   localStorage.setItem("city-pin-map.user-icons.v1", JSON.stringify([
     { id: "bad", name: "Broken", tintable: true, fillSvg: "<svg", attribution: null, createdAt: 1 }
   ]));
   ```
3. Reload the page.
4. **Observed:** banner "Failed to load pin sprite … Markers will not render." and no pins, no labels, no route on the map — even though every pin uses the built-in `circle` icon. Swapping basemaps does not recover.
5. **Expected:** the broken icon is skipped (pins referencing it fall back to the default icon via the existing `effectiveIcon()` clamp) and all other pins render normally.

## Acceptance criteria

- [x] With one corrupt user icon in storage, all pins still render (pins that referenced the bad icon show the default icon).
- [x] A user-visible banner still reports the icon that failed, naming it once — not on every styledata cycle.
- [x] Basemap swaps continue to re-register the healthy icons.
- [x] Adding a new valid custom icon while a corrupt one exists still registers and renders the new icon.
- [x] No regressions in PIL-001 flows (add icon, delete icon, tint/as-is rendering).
- [x] No errors in browser console beyond the intentional warning for the failed sprite.

## Files affected

```
~ js/map.js
```

## Out of scope

- Validating `userIcons` at backup-import time (tracked as FBL-004; this finding is the render-side hardening that must hold regardless).
- Removing corrupt icons from the store automatically.

## Implementation prompt

> Paste into a coding agent:

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md.

Task: Make pin-sprite loading fault-tolerant per icon instead of all-or-nothing.

Requirements:
- In js/map.js, change loadPinIconImages() to use Promise.allSettled (or per-promise catch) so one failed fetchImage cannot reject the batch. Return or record which icon ids failed.
- In addPinAndRouteLayers() and the subscribeIcons callback in initMap(), proceed with layer/image setup for every icon that DID load; skip addImage for failed ones. Never skip creating the pins/route sources and layers because an icon failed.
- Pins whose icon image is missing must fall back to the default icon at feature-build time (extend pinsToFeatureCollection/effectiveIcon handling so icon-image never references an unregistered image — MapLibre logs "Image could not be loaded" and drops the feature otherwise).
- Surface one showError() banner naming the failed icon(s), debounced so basemap swaps don't re-spam it.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Preserve the existing pinIconImages cache semantics (successful loads stay cached across style swaps).

Verification:
- Seed a corrupt icon via localStorage (fillSvg: "<svg"), reload: pins render with default icon, banner appears once, style swaps keep working.
- Remove the corrupt key, reload: everything renders as before.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Found during a full-codebase correctness review (2026-07-03). The `effectiveIcon()` clamp already protects against *unknown icon ids*; this gap is about *known ids whose image fails to materialize* — the clamp passes them through and the loader then poisons the whole layer-setup path.
