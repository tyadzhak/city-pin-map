# FBL-003: Failed basemap swap leaves the style picker and app state pointing at the wrong style

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-003`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Todo`                                      |
| **Severity**    | `Medium`                                    |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | None                                        |

## Summary

When a style swap fails (network error, bad key, 5s timeout), `setMapStyle()` correctly reverts the *map* to the previously-rendered style — but nothing tells the UI. The picker's trigger label and active row, and `app.js`'s `activeStyleId` mirror, keep showing the style that failed. The hide-labels raster notice is then computed from the wrong style entry. `style-picker.js`'s own header comment says `setActive` is returned "so the caller can update the trigger label + active row when a style is set externally (boot, **failed-swap revert**, etc)" — but that wiring was never added.

## Context

**Files and lines:**

- `js/map.js` lines 701–712 (`onError` in `setMapStyle`): reverts via `setMapStyle(previousId, { persist: false })` with no way to inform callers. `setMapStyle` has no completion/revert callback or event.
- `js/style-picker.js` lines 315–331 (`renderRow` click handler): calls `setActive(entry.id)` **before** `onSelectCb(entry.id)`, i.e. optimistically, and nothing ever calls the returned `setActive` afterwards.
- `js/app.js` lines 80–95: `onSelect` sets `activeStyleId = id` optimistically; on a failed swap it is never corrected, so `refreshHideLabelsNotice()` (lines 180–186) evaluates `isRasterStyleEntry` against the failed style, showing/hiding the "labels are baked into raster tiles" notice incorrectly.
- Related fragility, same fix area: `js/app.js` line 82 passes `getCurrentStyleId: () => initialStyleId` — a closure over a variable that is never reassigned. It is only *called* once at boot today, so it happens to work, but it silently returns stale data if the picker ever re-reads it.

User-visible symptoms after a failed swap:

1. Header reads "Map: Stamen Watercolor" while the map renders the previous style.
2. Reopening the picker highlights the failed style as active.
3. The hide-labels notice can appear for a vector style (or vice versa).

Persistence is *not* affected (`saveMapStyle` only runs on success), so a reload self-heals — which is why this is Medium, not High.

## Steps to reproduce

1. In Settings, enter any non-empty garbage Stadia key (e.g. `xxx`) so Stadia rows unlock.
2. Pick "Stamen Watercolor" from the style picker.
3. Style JSON fetch fails → banner "Stadia rejected the API key…" and the map stays on the previous style.
4. **Observed:** the header trigger still says "Stamen Watercolor"; reopening the picker shows Watercolor as the active row.
5. **Expected:** trigger label and active row revert to the actually-rendered style; the hide-labels notice reflects it.

(Alternative repro without a key: throttle the network to offline and pick any OpenFreeMap style — the 5s timeout path behaves the same.)

## Acceptance criteria

- [ ] After a failed swap, the picker trigger label shows the style actually rendered on the map.
- [ ] After a failed swap, reopening the picker highlights the actually-rendered style as active.
- [ ] The hide-labels raster notice is computed from the actually-rendered style after a failed swap.
- [ ] Successful swaps behave exactly as before (label updates, persistence on success only).
- [ ] `getCurrentStyleId` (or its replacement) returns the live style id, not the boot-time id.
- [ ] No regressions in the locked-row → settings deep-link flow.
- [ ] No errors in browser console.

## Files affected

```
~ js/map.js
~ js/app.js
~ js/style-picker.js
```

## Out of scope

- Retry/backoff for failed style loads.
- Persisting anything on failure (current success-only persistence is correct and must stay).

## Implementation prompt

> Paste into a coding agent:

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md.

Task: Propagate style-swap outcomes (success AND revert) from map.js to the UI so the picker and app state never desync.

Requirements:
- Add a notification path from js/map.js setMapStyle to interested callers — simplest: an onStyleRendered(styleId) subscriber list (mirroring the pins.js pub/sub shape) fired from the onSuccess path, which the revert call also flows through since it re-enters setMapStyle. Alternatively accept an options callback. Pick one, keep it small.
- In js/app.js: on that notification, update activeStyleId, call pickerHandle.setActive(styleId), and refreshHideLabelsNotice(). Remove the optimistic assumption if it becomes redundant, or keep the optimistic update for responsiveness and rely on the notification to correct failures.
- Fix getCurrentStyleId to read the live value (e.g. () => activeStyleId).
- In js/style-picker.js, no structural change should be needed — setActive is already the designed entry point.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Do not change the persistence contract: saveMapStyle only on success.

Verification:
- With a garbage Stadia key, pick Stamen Watercolor: banner appears, map keeps prior style, header label snaps back to the prior style, picker active row is correct.
- Normal swap between OpenFreeMap styles still updates label + persists.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Found during a full-codebase correctness review (2026-07-03). The design intent (picker `setActive` for the revert case) is documented in `style-picker.js`'s header; the wiring was simply never completed.
