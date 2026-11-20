# UXR-008: Pin icon tiles in the list are always black

| Field           | Value        |
|-----------------|--------------|
| **ID**          | `UXR-008`    |
| **Milestone**   | `UX review`  |
| **Status**      | `Done`       |
| **Severity**    | `Medium`     |
| **Priority**    | `Medium`     |

## Summary

Icon tiles in the pin list and the Design tab "Default pin" tile rendered the glyph as an `<img>` of an SVG data URI. An SVG in an `<img>` cannot inherit CSS `color`, so every tile showed a black icon while the map pin was red or navy.

## Context

**Files:** `js/icons.js`, `js/pin-list.js`, `js/app.js` (`initDefaultPinOptions` tile rendering only), `js/icon-picker.js`, `index.html`, `css/styles.css`, `js/icons.test.mjs`

## Failure scenario

The user recolors a pin (or puts it in a colored group) and the row's tile stays black, so the list never matches the map. The default-pin tile ignores the chosen default color the same way.

## Fix direction

New `renderIconGlyph(host, entry)` in `js/icons.js` (plus pure `iconUrl`). Tintable icons render as a span with `background-color: currentColor` and a CSS `mask-image` of the icon, so the host's `color` (already set to the effective color) tints it. Non-tintable icons keep the `<img>`. Used by the pin-list tile, the default-pin tile (static `<img>` removed from `index.html`), the icon-picker grid tiles and the add-icon "Tinted" preview. Aria labels preserved.

## Acceptance criteria

- [x] Tiles show each pin's effective colour and update on recolor: tile `color` is the resolved effective color; list re-renders on recolor as before.
- [x] Default-pin tile shows the default colour: `refreshTile` sets tile color and renders the masked glyph.
- [x] Non-tintable icons unchanged: still `<img>`.
- [x] `node --test js/*.test.mjs` passes (iconUrl test added).
