# UXR-021: "New map" clears pins and groups but keeps the title, frames, fade and inset

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-021`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Medium`                                    |
| **Priority**    | `Medium`                                    |
| **Depends on**  | UXR-006 (File menu placement of "New map...") |

## Summary

The File-menu "New map..." item only emptied the pin and group stores. The poster composition (on-map title, frames, bottom fade, inset map) survived, so a user expecting a fresh start still saw their old title, frame and fade.

## Context

**Files:** `js/app.js`

- `initSnapshotControls` `snapshot-new` handler.
- `initOnMapTitle`, `initExportFrameOptions`, `initBottomFadeOptions`, `initInsetOptions` (init handles).

## Failure scenario

User builds a poster (title, Frame 1, fade, inset), clicks File > New map..., accepts the confirm, and the map keeps the title, frame, fade and inset while the pins vanish.

## Fix direction

- Each of the four init functions now returns / extends a handle with `getState()`, `setState(state)` and `reset()` (`reset()` = `setState(defaults)`, defaults from `normalizeX(null)` so storage default changes are picked up automatically). `setState` normalizes the input, writes the controls (including the dependent-controls `data-*` attributes and, for frames, the hidden "Outside frame" block via the normal `persist()` path), saves through the existing save path and refreshes the live overlay. The inset's `getState()` includes `freePos`. This is the hook UXR-004 (Undo) should use: capture `getState()` from each handle before New, call `setState(captured)` to restore.
- `initInsetOptions` now returns its handle (it returned nothing before). Frame/outside cluster wirers expose `writeFrame`/`writeOutside` so boot hydration and `setState` share one code path.
- `initSnapshotControls({ resetDesign })` runs the four resets after the stores are emptied. No reload.
- Confirm text now always shows (design state is always at stake): "Start a new map? This clears N pins and M groups, the title, frames, fade and inset map. Your map style and pin style stay, and your last saved snapshot is unaffected."
- Kept: basemap, hide-labels, route toggle, pin style, default pin, export size/quality, API keys, user icons, snapshot slot.

## Acceptance criteria

- [x] After New map the map and Design tab look like a fresh profile except kept preferences. *(Playwright smoke: title input empty with one default row, Frame 1 off with Outside block hidden, fade off, inset off with no group, pin size 40 kept; screenshot checked.)*
- [x] The confirm text lists what is cleared. *(Message captured in smoke.)*
- [x] No reload. *(Reset is in place; stores and localStorage keys verified to hold defaults.)*
- [x] `node --check js/app.js` and `node --test js/*.test.mjs` pass.

## Files affected

```
~ js/app.js
+ jira/ux-review/uxr-021-new-map-resets-design.md
```
