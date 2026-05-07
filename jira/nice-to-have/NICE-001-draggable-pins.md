# NICE-001: Drag pins to fine-tune position

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `NICE-001`                                  |
| **Milestone**   | `Nice-to-have`                              |
| **Status**      | `Todo`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M`                                         |
| **Depends on**  | `CORE-002`, `CORE-003`, `CORE-005`          |

## Summary

Let the user grab a pin on the map and drop it at a new location. The pin's `lat`/`lon` update through the existing pin store so the change persists, the side panel reflects the move, and the PNG export captures the new position. After this task the user can nudge a city pin onto the exact spot they want before exporting.

## Context

`PROJECT.md` → "Goal" frames the output PNG as the product, so being able to fine-tune a pin's position visually is a direct improvement to that output. CORE-005 (`js/map.js` → `renderPins`) currently renders each pin as a non-draggable `L.circleMarker`. CORE-003 already exposes `updatePin(id, patch)`, which is the only mutation entry point needed here — once the new lat/lon are pushed through it, CORE-004 persists them and CORE-005's marker sync keeps everything coherent.

`CLAUDE.md` → "Pin data model" leaves `lat` and `lon` as plain numbers, so no schema change is needed.

A subtle gotcha (called out in CORE-012's notes): `L.circleMarker` was chosen over `L.divIcon` partly because vector circles capture cleanly through `dom-to-image-more`. Switching marker types to gain native drag support would risk regressing the exported PNG. Implementing drag without changing the marker type is therefore the lower-risk path.

## Acceptance criteria

- [ ] On the map, the user can press-and-hold any pin marker and drag it to a new position. The marker visually follows the cursor in real time.
- [ ] On release, the pin's `lat` and `lon` are updated via `updatePin`. The pin list row stays mapped to the same pin (id unchanged); only the position changes.
- [ ] Refreshing the page restores the pin at its new dragged position (persistence via CORE-004 still works automatically).
- [ ] Dragging does not pan the underlying map. (The map only pans when dragging starts on empty map space, not on a marker.)
- [ ] The PNG export (CORE-012) still produces a clean image with all markers visible at their on-screen positions, including any that have been dragged.
- [ ] Tooltip / label behavior from CORE-005 still works: hovering a pin still shows its name.
- [ ] No regressions in previously completed tasks (search, rename, color picker, remove, export).
- [ ] No errors in browser console.

## Files affected

```
~ js/map.js
~ css/styles.css
```

## Out of scope

- Snap-to-city or geocode-on-drop behavior — the dropped position is taken at face value.
- Touch/mobile gestures beyond what the desktop drag implementation gives for free (per `PROJECT.md` → "Out of scope": desktop is the primary target).
- A visual confirmation/undo affordance after drop. The drop just commits.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope.

Task: Make the existing map markers draggable, and propagate drop positions to the pin store.

Background you need to know:
- Markers are currently rendered as L.circleMarker in js/map.js → createMarker / renderPins.
- CORE-012 deliberately picked L.circleMarker (over L.divIcon / L.marker) because the vector circle captures cleanly via dom-to-image-more. Do NOT switch to L.marker just to get the built-in `draggable: true` option — that could regress the PNG export.
- CORE-003 exposes `updatePin(id, patch)` from js/pins.js. That is the one and only way mutations should reach the store; persistence (CORE-004) and re-render (CORE-005) are wired to it already.

Requirements:
- Implement drag for circleMarker manually inside js/map.js. Suggested approach:
  1. On `mousedown` on a marker, disable map dragging (`mapInstance.dragging.disable()`) so the map doesn't pan.
  2. On `mousemove` over the map, convert the latest container point to lat/lng with `mapInstance.containerPointToLatLng(...)` and call `marker.setLatLng(...)` so the marker tracks the cursor.
  3. On `mouseup` (anywhere), call `updatePin(pin.id, { lat, lon })`, re-enable map dragging, and detach the temporary listeners.
  4. Make sure the same logic also works when the cursor leaves the map mid-drag (treat document-level mouseup or mouseleave as a commit).
- Set the marker's CSS cursor to "grab" by default and "grabbing" while dragging, so the affordance is visible. (You can do this via `marker.getElement().style.cursor` after creation, or via a CSS class added to the marker element.)
- Keep `renderPins` idempotent: when the store fires its post-update notification, the existing marker for this id must NOT be torn down and rebuilt — `updateMarker` should just set the new latLng, which is what CORE-005 already does. Verify this.
- Do NOT introduce a Leaflet plugin (e.g. Leaflet.Path.Drag). Keep the dependency surface unchanged.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks, no new CDN libraries without explicit approval).
- Match the file layout and coding conventions in CLAUDE.md (ES modules, async/await, vanilla DOM).
- Do not change the pin data model.
- Do not switch L.circleMarker to L.marker / L.divIcon — keep the export-friendly marker type.

Deliverables:
- Updated js/map.js with the drag handlers wired into createMarker.
- Updated css/styles.css with grab/grabbing cursor styling for the marker (a CSS class is fine).

Verification:
- Open index.html (or a static server). Add three pins via the search input.
- Press and hold any pin and drag it across the map. The marker follows the cursor smoothly; the map does NOT pan.
- Release. The pin's row in the side panel still has the same name; only the position has changed.
- Refresh the page. The dragged pin reloads at its new lat/lon (verify via DevTools → Application → Local Storage; the saved JSON has the new coordinates).
- Click "Export PNG". Open the resulting image. The dragged pin appears at the new position; all markers render cleanly with no missing tiles or distortions.
- Tab-navigate through the pin list (CORE-008/CORE-011 affordances) and confirm Edit, Color, Remove still work.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

If manual drag turns out to be unexpectedly painful with `L.circleMarker` on some browser, the fallback is to use `L.marker` with a `divIcon` styled as a colored circle (`draggable: true` works out of the box). Before going that route, run the PNG export and confirm the image still looks right — if it does, the original CORE-012 concern no longer applies and the simpler implementation is fine. Document the choice in this task's status update.
