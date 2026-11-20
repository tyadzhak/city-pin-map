# UXR-011: "Frame 1" is white by default

| Field         | Value       |
|---------------|-------------|
| **ID**        | `UXR-011`   |
| **Milestone** | `UX review` |
| **Status**    | `Done`      |
| **Severity**  | `Medium`    |
| **Priority**  | `Medium`    |

## Summary

Ticking "Frame 1" on a fresh profile produced a 60px white band flush with the map edge, which looked like the map had simply shrunk rather than like a frame.

## Context

**Files:** `js/storage.js` (`DEFAULT_EXPORT_FRAME`), `js/storage.test.mjs`

- Defaults are consumed only for missing/invalid fields by `normalizeFrame()` and for the fresh-profile frame set; saved frames are loaded verbatim.
- `index.html` has no default values for the frame inputs (they are populated from the loaded state), so no HTML change was needed.

## Failure scenario

A new user ticks "Frame 1" and sees a white strip on the map edge: no visible frame, and no mat outside it.

## Fix direction

Frame 1 defaults changed to a charcoal `#1f2937` band, thickness 14, margin 24 (padding and radius stay 0). The map shows through outside the band, so the frame reads as a poster border. Frame 2's default (4px black band at margin 16) is unchanged and nests OUTSIDE Frame 1 (hairline at 16-20, 4px gap, thick band at 24-38), so enabling both gives a sensible double frame. The bottom fade (white, at the bottom edge) and the title sit inside/under the frame overlay as before.

## Acceptance criteria

- [x] On a fresh profile, ticking Frame 1 shows an obvious frame. *(Defaults are a 14px charcoal band inset 24px.)*
- [x] Existing saved frames are unchanged. *(Only missing/invalid fields use defaults; saved-value tests still pass.)*
- [x] Tests are updated and pass. *(`js/storage.test.mjs` default expectations updated; all node tests pass.)*

## Files affected

```
~ js/storage.js
~ js/storage.test.mjs
+ jira/ux-review/uxr-011-visible-frame-default.md
```
