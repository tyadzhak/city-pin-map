# UXR-031: Keyboard — skip links, strong focus ring, fewer tab stops before the sidebar

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-031`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Low`                                       |
| **Priority**    | `Low`                                       |

## Summary

Keyboard users had to Tab through the header, the map canvas, zoom/fit controls and five attribution links before reaching the sidebar, and many controls hid their outline in favour of a faint box-shadow.

## Context

**Files:** `index.html`, `css/styles.css`, `js/map.js`

- `js/map-inset.js` already constructs the inset with `attributionControl: false`, so it adds no tab stops.

## Failure scenario

A keyboard user pressing Tab from page load lands on the search box, crosses ~10 stops (map canvas, attribution links) to reach the side panel, and often cannot see which control is focused.

## Fix direction

- Two skip links at the top of `<body>` ("Skip to side panel", "Skip to map"), hidden off-screen until focused; targets `#side-panel` / `#map-region` got `tabindex="-1"`.
- Global `:focus-visible` rule (2px solid blue, 2px offset, `!important` to beat per-component `outline: none`); tabs use an inset offset so the ring is not clipped. Mouse focus is unaffected.
- `attributionControl: { compact: true }` plus collapsing the control once on `load` (MapLibre opens it initially), so the attribution links are no longer tab stops but the (i) button remains.

## Acceptance criteria

- [x] First Tab reveals a skip link that jumps to the sidebar. *(Playwright: first Tab focuses "Skip to side panel"; Enter focuses `#side-panel`; next Tab lands inside `.app-side`.)*
- [x] Focus is clearly visible on every control. *(Global rule; screenshot shows ring on the Design tab.)*
- [x] Fewer tab stops before the sidebar. *(Playwright: attribution links are no longer tab stops (4 fewer, incl. the (i) button). Stops before the sidebar read 10 on the stale main checkout and 11 now, because the already-merged zoom/fit/settings controls (+4) and the two new skip links (+2) were added; without this change it would be 15.)*
- [x] Attribution is still present. *(Compact (i) button remains.)*
- [x] `node --check` and `node --test js/*.test.mjs` pass.
