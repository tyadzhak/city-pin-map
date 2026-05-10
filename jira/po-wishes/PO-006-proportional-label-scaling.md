# PO-006: Scale exported text proportionally to canvas size

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-006`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M`                                         |
| **Depends on**  | `PO-005` (preset to validate against)       |
| **Depends on (soft)** | `PO-002` for pin label scaling      |

## Summary

When the user exports at different presets (1080² square, A4, A3, 10×15 photo, current view) the title-strip text and pin labels currently render at fixed font sizes. The result: titles look oversized on a 1080² square and undersized on A3. Introduce a scaling coefficient that's a function of the target canvas's longest dimension, so titles and pin labels remain visually balanced (~3-5% of the canvas height) across every preset.

## Context

`js/export.js` → `drawTitleStrip(ctx, { title, subtitle, height, width })` currently uses fixed values from a `TITLE_STRIP` constants object: `titleSize: 32`, `subtitleSize: 18` (or similar), with explicit pixel values for line-height and padding. These were tuned for a typical 1280-px-wide capture and look correct there. They drift visibly off at the extremes:

- 1080×1080 (square preset): titles dominate the canvas because the relative ratio is too high.
- 2480×3508 (A4 portrait at 300 DPI, if introduced) or 1772-px-tall (10×15): titles look like footnotes.

The right model is a scaling coefficient `coeff = canvasLongestSide / REFERENCE_BASELINE`, applied multiplicatively to every typographic constant in `drawTitleStrip`. Reference baseline of 1280 px keeps the existing 16:9 (1920×1080) preset close to today's appearance (coeff ≈ 1.5), while squaring up the 1080² (coeff ≈ 0.84) and bumping A3 (coeff ≈ 3.0) toward visual parity.

For pin labels (PO-002, MapLibre symbol layer), the scaling is different: the symbol layer's `text-size` is in screen pixels at the live map zoom, NOT relative to the export canvas. To scale pin labels for an export, the right approach is to bump `text-size` immediately before the export's `getCanvas()` capture and restore it afterwards — same pattern as the canvas resize for non-current presets.

## Acceptance criteria

- [x] Title font size in the exported PNG scales proportionally with the canvas's longest dimension.
- [x] Subtitle font size scales the same way (preserving the existing title:subtitle ratio).
- [x] Title-strip padding and line height scale with the same coefficient (so a heavier title doesn't compress against the strip's edges).
- [x] Pin labels (if PO-002 has landed) scale similarly during the export capture and restore to their on-screen size after.
- [x] On the existing 1920×1080 (16:9) preset, exported titles look approximately the same as before this task ships (coefficient ~1.5 ≈ today's tuned-for-1280 default).
- [x] On the 1080² square preset, titles fit comfortably without dominating the canvas.
- [x] On A3 / 10×15 / large presets, titles read at a presentation-poster scale rather than as a footnote.
- [x] On the "Current view" preset (capture-as-is), no scaling math is applied and behavior matches today exactly (the criterion: NICE-006's golden output remains pixel-identical at the same on-screen size).
- [x] Coefficient is clamped to a reasonable range (e.g. [0.6, 2.5]) so an extreme custom dimension doesn't produce unreadable extremes.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/export.js
~ js/map.js   (only if PO-002 has landed and pin labels need scaling)
```

## Out of scope

- **Per-preset font-size overrides.** A formula is enough; per-preset tables are a maintenance liability.
- **User-tunable scaling factor in the UI.** The whole point is the user shouldn't have to think about it. If a user wants a specific title size at A4, the right escalation is a custom typography v2 task.
- **Different scaling rules for different preset types** (e.g. "scale less aggressively for landscape than portrait"). One coefficient based on longest side handles both with acceptable visual consistency.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read js/export.js — especially drawTitleStrip and the off-screen capture pipeline.

Task: Introduce a proportional scaling coefficient for the title strip and (if PO-002 has landed) for pin labels at export time.

Requirements:

js/export.js:
- Add REFERENCE_BASELINE = 1280 as a top-level constant.
- Compute coeff = clamp(Math.max(canvas.width, canvas.height) / REFERENCE_BASELINE, 0.6, 2.5) at the start of the export flow, where canvas.width / canvas.height are the target preset dimensions (or, for "current", the live map's canvas dimensions).
- Refactor drawTitleStrip to take coeff as a parameter and multiply every typographic constant (titleSize, subtitleSize, padding, line height) by it. Keep TITLE_STRIP as the source of truth for the BASE values; the multiplication happens inside drawTitleStrip.
- For the "current" preset, coeff is computed against the live map canvas — which usually sits between 800 and 1600 px depending on the user's window. This produces a coefficient close to 1.0 for typical viewports, so behavior on the "current" preset stays close to NICE-006's appearance.
- Verify that title-strip height (the band's pixel height) also scales with coeff so the strip doesn't crop a scaled title.

js/map.js (only if PO-002 has landed):
- Export setPinLabelSize(sizeOrNull). If size is null, restore the live default. Otherwise, call setLayoutProperty(PINS_LABELS_LAYER_ID, "text-size", size).
- In js/export.js, immediately before the off-screen capture and after the resize step (if any), call setPinLabelSize(BASE_PIN_LABEL_SIZE * coeff). After the capture (in the same finally block that restores canvas dimensions), call setPinLabelSize(null) to restore.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- Do NOT introduce a per-preset overrides table.
- Do NOT change any storage keys; the title and subtitle text persist via NICE-006's existing key.

Deliverables:
- Updated js/export.js with REFERENCE_BASELINE, coeff computation, drawTitleStrip refactor.
- Updated js/map.js with setPinLabelSize export (only if PO-002 has landed).

Verification:
- With a title set ("Italy 2024") and subtitle ("September trip"), export at every preset:
  - Current view: title looks essentially the same as before this task.
  - 1080² square: title fits comfortably; doesn't crowd the canvas.
  - 1920×1080 (16:9): title looks comparable to today's tuned-for-1280 default (coeff ~1.5).
  - A4 portrait: title visibly larger, sized for a posterboard read at arm's length.
  - 10×15 portrait (300 DPI): title sized appropriately for the photo print.
  - A3 (if it exists in the registry): title even larger; not capped by the [0.6, 2.5] clamp at A3 scale.
- If PO-002 has landed: pin labels at the 1080² square export are smaller relative to their on-screen size; pin labels at A3 are larger. After every export, on-screen pin labels return to the live default.
- Re-run the NICE-006 verification scenarios — empty title-only-subtitle and subtitle-only paths still skip the strip / render only one line correctly.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- **Why 1280 as the baseline?** Today's title-strip constants were tuned by eye against a typical browser viewport (1280–1440 px wide). Anchoring the coefficient there means coeff ≈ 1.0 for "current" exports — preserving the visual contract NICE-006 set, without forcing a re-tuning of every value.
- **Why clamp [0.6, 2.5]?** Below 0.6 the title becomes unreadably small even on a 540-px canvas. Above 2.5 the title eats the canvas at extreme custom dimensions. The clamp is defensive against future presets that might land outside the tested range; tighten if you observe a real preset hitting the bounds.
- **Pin labels and live-map UX.** Bumping `text-size` inside the export's brief off-screen window doesn't affect the live UI because the wrapper is hidden during capture (NICE-007's off-screen positioning trick — verify it still applies to MapLibre after HARDEN-009's port). If pin labels visibly flash during export, the bug is in the wrapper's hide/show, not in this task — investigate `setStyleSafely` and the hidden-wrapper flow before adjusting setPinLabelSize.
- **What this task is NOT doing**: changing the title's typeface, alignment, color, or weight. Just size scaling. Custom typography is a separate concern.
