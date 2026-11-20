# UXR-030: Console warnings "Expected value to be of type number, but found null instead" and `Image "circle-11" could not be loaded`

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-030`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Low`                                       |
| **Priority**    | `Low`                                       |
| **Depends on**  | None                                        |

## Summary

The UX walkthrough logged "Expected value to be of type number, but found null instead" (3x) during box-select and group delete, and the OSM style logged `Image "circle-11" could not be loaded`. The number warning is emitted by the basemap's own style layers, not by this app's layers, and is left alone. The missing-image warning is silenced with a `styleimagemissing` guard on both maps.

## Context

**Files:** `js/map.js`, `js/map-inset.js`

- `js/map.js` new exported `installMissingImageGuard(map)`, called from `initMap()`.
- `js/map-inset.js` calls it right after creating the inset map.

## Failure scenario

Opening DevTools while using the app shows repeated MapLibre warnings, which hides real problems.

## Fix direction

Reproduction (headless Playwright, console listener with `msg.location()`, current main): seeded pins and a group, Shift+drag box-select assigned to a new group, group deleted in the Groups tab, inset enabled with a group, route toggled on and off, then zoom 5/8/11/14 on Berlin; run on `carto-light` and `osm`.

- "Expected value to be of type number, but found null instead": NOT reproduced during box-select, group delete, inset or route toggles. It appears only when zooming in and tiles load (3 occurrences, source location is a worker blob), and it appears identically on both basemaps with NO pins at all. It is therefore evaluated by the basemap's own style layers in the tile worker, not by this app. The app's numeric paint/layout properties are constants, and every feature-property read (`color`, `icon`, `tintable`) is a string or boolean that `pinsToFeatureCollection` always materializes, so there is no null numeric read to coalesce and no code change was made for it.
- `circle-11`: the OSM (Liberty) style's POI layers use data-driven `icon-image` expressions, so tile data can request ids absent from its sprite sheet. The warning did not fire on its own in the headless run, so it was triggered synthetically (symbol layer with `icon-image: "circle-11"`): before, `Image "circle-11" could not be loaded` logged; after, nothing. `installMissingImageGuard()` registers a transparent 1x1 image on `styleimagemissing`, on the main and inset maps. App pin ids (`city-pin-map.icon.` prefix) are skipped so a genuinely missing app icon is still loud.

## Acceptance criteria

- [x] Neither warning appears in the reproduced flows. *(After the fix, the box-select/group-delete/inset/route flow logged no warnings. The number warning still appears on tile load at zoom, from the basemap; see above. `circle-11` is silent.)*
- [x] The fix is explained here. *(See Fix direction.)*

## Files affected

```
~ js/map.js
~ js/map-inset.js
+ jira/ux-review/uxr-030-console-warnings.md
```

## Notes

Not verified: the number warning's exact originating style layer (it lives inside the basemap vector style).
