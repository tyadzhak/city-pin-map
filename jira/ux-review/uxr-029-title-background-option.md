# UXR-029: The title always sits on a white box

| Field           | Value          |
|-----------------|----------------|
| **ID**          | `UXR-029`      |
| **Milestone**   | `UX review`    |
| **Status**      | `Done`         |
| **Severity**    | `Low`          |
| **Priority**    | `Low`          |

## Summary

The on-map title always drew a translucent white chip, live and in the PNG, even over the bottom fade that exists to give the title a clean backdrop. A Title "Background" option (Box / None) now controls it.

## Context

**Files:** `js/storage.js`, `js/map-title.js`, `js/export.js`, `js/app.js` (`initOnMapTitle`), `index.html` (Title group), `css/styles.css`, `js/storage.test.mjs`

## Failure scenario

The user turns on the bottom fade to make a poster caption zone, types a title, and still gets a white rectangle with a border and shadow around it. There was no way to remove it.

## Fix direction

- New title-level field `background: "box" | "none"` in the on-map title shape, normalized by `normalizeOnMapTitle` (missing or invalid values become `"box"`, so old saves keep the box).
- Design tab Title group: a "Background" select (`#otm-background`), wired in `initOnMapTitle`, synced through `getState`/`setState`/`reset` (reset returns to "box").
- Live overlay: `map-title.js` carries `background` and toggles `.export-on-map-title--no-box` (transparent fill, no border/shadow/blur; padding kept so text position is identical).
- Export: `prepareOnMapTitle` passes `background` through; `drawOnMapTitle` skips the fill and border when `"none"`. No text halo, so live and export match exactly.

## Acceptance criteria

- [x] "None" removes the box in both the live view and the PNG. *(Playwright smoke with the fade on: overlay computed background/border transparent, shadow none; exported PNG shows the title with no chip. Both screenshots viewed.)*
- [x] Old saved titles still show the box. *(Node tests: missing/invalid `background` normalizes to `"box"`.)*
- [x] Tests pass. *(`node --test js/*.test.mjs` clean; `node --check` on changed modules clean.)*

## Files affected

```
~ js/storage.js
~ js/storage.test.mjs
~ js/map-title.js
~ js/export.js
~ js/app.js
~ index.html
~ css/styles.css
+ jira/ux-review/uxr-029-title-background-option.md
```
