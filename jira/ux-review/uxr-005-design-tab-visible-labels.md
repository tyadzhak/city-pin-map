# UXR-005: Design-tab number boxes have no visible labels

| Field           | Value             |
|-----------------|-------------------|
| **ID**          | `UXR-005`         |
| **Milestone**   | `UX review`       |
| **Status**      | `Done`            |
| **Severity**    | `High`            |
| **Priority**    | `High`            |

## Summary

Pin size, label size, frame thickness/padding/margin/radius (x2), outside-frame blur and bottom-fade height/intensity were bare number boxes identified only by hover tooltips. The "Outside frame" block showed even with no frame enabled, and title line rows wrapped B/I apart from the other formatting controls.

## Context

**Files:** `index.html`, `css/styles.css`, `js/app.js`

- Design tab markup (Pin style, Frames, Outside frame, Bottom fade, Inset map, Default pin).
- `js/app.js`: `initExportFrameOptions` (outside visibility), `buildLineRow` (title row layout).

## Failure scenario

The user sees "60 / [] / 0 / 0 / 0 / Shadow" and cannot tell which box is which without hovering. "Outside frame" is offered although it does nothing until a frame is on.

## Fix direction

- Every numeric/colour/select control is wrapped in a `.design-field` with a short visible caption (units where relevant), laid out in a 3-column grid (2 for the inset) that fits 320px. All ids unchanged; aria-labels kept.
- "Outside frame" block (new id `frame-outside-block`) is `hidden` unless a frame is enabled, synced at boot and on every frame change; heading restyled to match the Design sub-headings.
- Title rows: text input on its own line; font / B / I / color / size(px) / remove together on one non-wrapping line beneath.

## Acceptance criteria

- [x] Every control in the Design tab has a visible caption. *(Title-row font/B/I/color/remove are self-describing glyph/select controls; size carries a "px" suffix.)*
- [x] "Outside frame" is hidden when all frames are off. *(Playwright: hidden at boot, shown after enabling a frame.)*
- [x] Title formatting controls sit on one line. *(Screenshot verified.)*
- [x] Nothing overflows at 320px. *(Playwright at 1440x900 and 1024x768, all frames/fade/inset enabled: no control outside the panel, scrollWidth == clientWidth.)*
- [x] Ids unchanged (one new id: `frame-outside-block`).

## Files affected

```
~ index.html
~ css/styles.css
~ js/app.js
+ jira/ux-review/uxr-005-design-tab-visible-labels.md
```
