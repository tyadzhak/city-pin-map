# FBL-005: PNG export resolution is inconsistent — adding a title (or any preset) silently halves output resolution on retina displays

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-005`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Todo`                                      |
| **Severity**    | `Medium`                                    |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | None                                        |

## Summary

The export pipeline mixes device pixels and CSS pixels depending on which path runs. The fast path ("Current view", no on-map title) returns the raw WebGL canvas at **device pixels** (2× CSS size on retina). The composite path (any preset, or "Current view" *with* a title) allocates the output canvas in **CSS pixels** and downscales the device-pixel map canvas into it. Net effect on a retina display: typing a title into the export options cuts the exported PNG's linear resolution in half for the same view. The frame feature inherits the same inconsistency — `wrapFrame`'s `thickness` is applied to whichever pixel space the inner canvas happens to be in, so a 60px frame is visually half as thick (relative to the image) on fast-path exports as on preset exports.

## Context

**File:** `js/export.js`

- Fast path — lines 113–120: `innerCanvas = mapInstance.getCanvas()` (device pixels; e.g. 2560×1440 for a 1280×720 CSS map at `devicePixelRatio` 2).
- Composite path — `captureFramed()` lines 160–171 sets `frameWidth/frameHeight` in CSS pixels; `composite()` lines 257–281 allocates `out.width = outputWidth` (CSS px) and `drawImage`s the device-pixel map canvas down into it. The comment at line 273 acknowledges mapCanvas is device pixels but chooses CSS-pixel output.
- Frame — `wrapFrame()` lines 326–350: `thickness` in "pixels" of whatever the inner canvas is; no dpr normalization. `loadExportFrame()`'s 0–200 clamp (storage.js) is therefore a different physical size per path.

Consequences (all on dpr>1 displays, which is most Macs — this is a macOS-targeted app per HARDEN-002):

1. "Current view" export **without** title: 2560×1440 PNG.
2. Same view, same preset, after typing a title: 1280×720 PNG — half the resolution, visibly softer, with no indication why.
3. Frame thickness 60 → 60/2560ths of the width in case 1, 60/1280ths in case 2.
4. Preset exports (1080², A4, …) always render at 1× regardless of display, so "A4 portrait" prints softer than the fast-path capture of the same area. (Arguably acceptable for the presets' fixed pixel contracts — but the title/no-title flip within one preset is not.)

## Steps to reproduce

1. On a retina Mac (dpr 2), leave export format on "Current view" and clear the on-map title.
2. Export PNG → note the file's pixel dimensions (2× the map's CSS size).
3. Type any on-map title, export again.
4. **Observed:** the new PNG is exactly half the width/height of the first, and noticeably blurrier at 100% zoom; a 60px frame looks relatively twice as thick as on the first export.
5. **Expected:** the same view exports at the same resolution whether or not a title is present; frame thickness reads consistently.

## Acceptance criteria

- [ ] "Current view" exports have identical pixel dimensions with and without an on-map title (and with/without a frame).
- [ ] On dpr>1 displays, the composite path renders at device resolution (or, if a deliberate decision is made to standardize on CSS pixels, the fast path is downscaled to match — either way the two paths agree; record the decision).
- [ ] Title chip and pin-label sizing remain visually correct after the change (the `coeff` math must account for the chosen pixel space).
- [ ] Frame thickness produces the same visual proportion on both paths.
- [ ] Preset exports still honor their documented pixel dimensions (1080×1080 stays 1080×1080 — scaling decisions inside are fine, output contract isn't).
- [ ] No regressions in PO-005/PO-006/PO-007/PO-008 export flows.
- [ ] No errors in browser console.

## Files affected

```
~ js/export.js
```

## Out of scope

- Sub-pixel drift of the projected title position on extreme presets (documented, accepted in PO-008 notes).
- Adding new export size presets or a DPI selector.

## Implementation prompt

> Paste into a coding agent:

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md.

Task: Unify pixel-space handling across the PNG export paths in js/export.js.

Requirements:
- Decide the output pixel space once: recommended — composite() allocates its canvas at device resolution for "current view" captures (outputWidth = mapCanvas.width, i.e. CSS × dpr) while presets keep their contractual pixel dimensions; scale the title-chip drawing coordinates and coeff accordingly (x/y ratios multiply the actual output dims; fontSize/padding multiply by the same factor).
- Normalize wrapFrame(): interpret frame.thickness in CSS pixels and multiply by the inner canvas's effective scale so both paths produce the same visual frame proportion.
- Keep the fast path fast (no extra canvas when no scaling is needed).
- Add a brief comment documenting the chosen pixel-space contract at the top of export.js.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Preset outputs must keep their documented dimensions (EXPORT_PRESETS values are a UI contract).

Verification:
- On a dpr-2 display (or DevTools device emulation with DPR 2): export current view with and without a title — identical dimensions, identical sharpness.
- Export A4 portrait: file is exactly 794×1123 (or a deliberately documented multiple).
- Frame at thickness 60 looks proportionally identical on both paths.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Found during a full-codebase correctness review (2026-07-03). Root cause is the PO-008 composite step choosing CSS-pixel output while the HARDEN-010 fast path kept the raw framebuffer; each was locally reasonable, the combination is the bug.
