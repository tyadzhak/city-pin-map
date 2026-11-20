# UXR-022: Default basemap is busy

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-022`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Low`                                       |
| **Priority**    | `Low`                                       |

## Summary

`DEFAULT_MAP_STYLE_ID` was `"osm"`, which in the registry is OpenFreeMap Liberty: a busy style with bilingual labels and a poor poster default. First-run users now boot on `"carto-light"` (OpenFreeMap Positron, labelled "Light").

## Context

**Files:** `js/map.js`

- `DEFAULT_MAP_STYLE_ID` is consumed by `initMap`, `setStyleSafely` fallbacks and `app.js` boot. A saved style id is read from `localStorage` first, so only profiles with no saved style (or an unknown one) are affected.
- Grep of `js/` and `test/coverage/scenarios` found no assumption that "osm" is the default; scenario 00 only clicks the "osm" picker row, which still exists.

## Failure scenario

A new user opens the app and sees the dense Liberty basemap behind their pins, which competes with pin labels in a poster export.

## Fix direction

Changed the constant to `"carto-light"` (keyless OpenFreeMap Positron) with a why-comment.

## Acceptance criteria

- [x] A fresh profile boots on the cleaner style. *(Default constant now `carto-light`.)*
- [x] A saved style is respected. *(Boot path unchanged; default only used when nothing valid is saved.)*
- [x] Tests and scenarios are updated. *(None assumed "osm" as default; no changes needed.)*
