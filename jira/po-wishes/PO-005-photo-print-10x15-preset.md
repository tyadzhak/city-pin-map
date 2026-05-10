# PO-005: Add 10×15 cm photo-print export preset

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-005`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S`                                         |
| **Depends on**  | `None`                                      |

## Summary

Add a 10×15 cm preset to the export format selector — the standard photo-print size used by every consumer photo lab. At 300 DPI the canvas is 1181×1772 px portrait. This is the most popular print format in consumer poligraphy, intended for users who want to print the map as a gift card or a souvenir at a photo kiosk.

## Context

`js/export.js` already exposes `EXPORT_PRESETS` — a map keyed by preset id with `{ width, height }` values. Today's set: `current` (null = capture as-is), `square-1080` (1080×1080), `landscape-16x9` (1920×1080), `a4-portrait`, `a4-landscape`, `a3-portrait`, `a3-landscape`. The selector in `index.html` is populated dynamically from `Object.entries(EXPORT_PRESETS)` and the persistence key `'city-pin-map.export-format.v1'` round-trips any new id without changes.

Adding 10×15 is a one-entry append: `"photo-10x15-portrait": { width: 1181, height: 1772, label: "10×15 cm portrait (300 DPI)" }`. The export-pipeline math (off-screen canvas, label scaling per PO-006 once it lands) handles arbitrary preset dimensions already.

## Acceptance criteria

- [x] The export format selector includes a new option labelled "10×15 cm portrait (300 DPI)" placed after the existing A-format presets and before any other addition.
- [x] Selecting it and clicking Export produces a PNG of exactly 1181×1772 px (within 1-pixel tolerance for any rounding).
- [x] The map content is rendered at the new dimensions: same center, same zoom, same pin set, same style, same route line, same group colors, same title/subtitle.
- [x] After export, the on-screen map returns to its original dimensions and is fully usable.
- [x] The chosen preset persists across reload (existing persistence already handles arbitrary ids — verify, don't re-implement).
- [x] No grey/missing tiles in the exported PNG.
- [x] Tile attribution remains visible.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/export.js
```

(One file. The selector population and persistence are entirely dynamic — no `index.html` change needed.)

## Out of scope

- **10×15 landscape** (1772×1181). Easy to add later if a user asks; only the portrait version is in the PO ask.
- **Other print sizes** (13×18, 15×21, 20×30). Same pattern when needed.
- **DPI choice override.** 300 DPI is the photo-lab standard and matches the user's intent ("for the photo kiosk"). Lower DPI for v2 would compromise print quality; higher DPI multiplies file size without the kiosks resolving past 300.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read js/export.js — especially the EXPORT_PRESETS map and the off-screen capture flow.

Task: Add a "10×15 cm portrait (300 DPI)" preset (1181×1772 px) to EXPORT_PRESETS.

Requirements:
- Append a new entry to EXPORT_PRESETS with id "photo-10x15-portrait", width 1181, height 1772, and label "10×15 cm portrait (300 DPI)".
- Preserve the existing iteration order of presets in the selector — append AFTER the A3 entries.
- Do not change any existing preset values.
- Do not change persistence keys.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- One file edit only.

Deliverables:
- Updated js/export.js with the new preset.

Verification:
- Open the app. The export selector now shows "10×15 cm portrait (300 DPI)" after the A3 entries.
- Pick the new preset. Export. The downloaded PNG is 1181×1772 px (verify in image properties).
- The map content is centered correctly and pins are visible. Tile attribution is readable.
- Reload. The preset selection persists.
- Switch back to "Current view". Export. PNG matches the on-screen map exactly (CORE-012 behavior).
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- 300 DPI is the standard for photo-lab printing (Fujifilm, Kodak, Canon kiosks). 96 DPI portrait at 10×15 cm would be 378×567 px — too soft to print at the intended size.
- The 1181×1772 number comes from `10 cm × 300 DPI ÷ 2.54 cm/inch ≈ 1181`, `15 cm × 300 DPI ÷ 2.54 ≈ 1772`. Round-half-up.
- This preset benefits especially from PO-006 (proportional label scaling) — at 1772 px tall the title text from NICE-006 looks lost without scaling. Sequence PO-005 before PO-006 so PO-006's coefficient math has the new preset to validate against.
