# PO-007: Optional decorative frame around exported PNG

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-007`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M`                                         |
| **Depends on**  | `None`                                      |

## Summary

Add an optional decorative frame around the exported PNG — Polaroid-style by default (white border), with user-pickable color and thickness, and an optional soft drop shadow. The frame extends the final canvas size beyond the chosen preset (e.g. a 1080² preset with a 60 px frame produces a 1200×1200 PNG). The result is a "ready to hang on the wall" image without external editing.

## Context

`js/export.js` already builds a composite canvas: `map.getCanvas()` painted onto an off-screen 2D canvas plus a title strip drawn via `ctx.fillText`. Adding a frame is a final pre-download pass: allocate a slightly larger canvas (target dimensions + 2 × frame thickness), fill with the frame color, then paint the existing composite at offset `(thickness, thickness)`. Optional shadow is a `ctx.shadowColor` / `ctx.shadowBlur` / `ctx.shadowOffsetY` set on the framed canvas before the paint.

Frame settings (toggle on/off, thickness, color, shadow on/off) live in the existing Export options panel, persisted via their own `localStorage` keys following the pattern from NICE-006 / NICE-007.

Sane defaults that don't require the user to think: 60 px white frame, no shadow.

## Acceptance criteria

- [ ] An "Add frame" toggle is visible in the Export options panel near the format selector.
- [ ] When ON: a thickness input (slider OR number input, accepting 0–200 px), a color picker, and a "Soft shadow" checkbox become visible.
- [ ] When OFF: the export pipeline behaves exactly as today — no frame, no shadow, original preset dimensions.
- [ ] When ON, the exported PNG has the chosen frame around the entire image, including the title strip if present.
- [ ] Final PNG dimensions = preset dimensions + (2 × thickness) on each axis.
- [ ] Default frame settings: thickness 60 px, color white (#FFFFFF), shadow off.
- [ ] Color picker change updates the persisted color; reload restores it.
- [ ] Thickness change persists.
- [ ] Shadow checkbox state persists.
- [ ] Frame is keyboard-accessible (toggle, inputs, color picker).
- [ ] Frame renders correctly on every preset (current view, 1080², A4, 10×15, etc.).
- [ ] No regressions in previously completed tasks (especially NICE-006's title strip and NICE-007's preset resizing).
- [ ] No errors in browser console.

## Files affected

```
~ js/export.js
~ js/storage.js
~ js/app.js
~ index.html
~ css/styles.css
```

## Out of scope

- **Gradient frames, multi-color frames, patterned frames.** A single solid color is enough for the Polaroid aesthetic ask. Gradients open a design rabbit hole.
- **Inner frame / double-frame / matte board** styling. One frame, one color.
- **Frame on the live map (preview).** The PNG is the preview — same convention as NICE-006's title strip.
- **Per-side frame thickness** (e.g. wider bottom for caption space). Symmetric four-side frame only.
- **Drop shadow direction / spread customization.** A single tasteful shadow recipe is fine. If user feedback demands more control, add it later.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read js/export.js — especially the off-screen canvas composition flow and how the title strip integrates with the map canvas.

Task: Add an optional decorative frame (color + thickness + optional shadow) drawn around the final composite at export time.

Requirements:

UI (index.html, css/styles.css):
- In the Export options panel, add a new "Frame" section with:
  - Checkbox "Add frame" (id="export-frame-enabled").
  - Number/range input "Thickness" 0–200 px (id="export-frame-thickness"), default 60.
  - Color picker (id="export-frame-color"), default "#ffffff".
  - Checkbox "Soft shadow" (id="export-frame-shadow"), default off.
- The thickness/color/shadow inputs hide themselves when the toggle is OFF (CSS-only via :checked sibling combinator OR a small JS toggle, your call). Keep the layout from collapsing on toggle.

Persistence (js/storage.js):
- loadExportFrame() → { enabled: boolean, thickness: number, color: string, shadow: boolean }, defaults { false, 60, "#ffffff", false }.
- saveExportFrame(value) under storage key 'city-pin-map.export-frame.v1'. Single-key object to keep the persistence count down. Same defensive try/catch pattern as siblings.

App wiring (js/app.js):
- Hydrate the four inputs from loadExportFrame() on bootstrap.
- On change of any input, persist the merged object via saveExportFrame.

Export (js/export.js):
- Read frame settings (or accept them as a parameter from app.js).
- After the existing composite (title strip + map canvas) is built, before the data-URL conversion:
  - If frame.enabled is false, skip — proceed exactly as today.
  - If frame.enabled is true:
    1. Allocate a NEW off-screen canvas of size (composite.width + 2*thickness) × (composite.height + 2*thickness).
    2. Get its 2D context. If frame.shadow is true, set:
         ctx.shadowColor = "rgba(0,0,0,0.25)";
         ctx.shadowBlur = Math.round(thickness * 0.4);
         ctx.shadowOffsetY = Math.round(thickness * 0.15);
       (Tune these once visually; they're the "soft Polaroid shadow" recipe. Document the chosen values.)
    3. Fill the framed canvas with the frame color.
    4. Reset shadow properties to defaults BEFORE painting the composite (otherwise the shadow re-applies to the inner composite).
    5. drawImage the composite onto the framed canvas at offset (thickness, thickness).
    6. The framed canvas becomes the new "composite" used for the data-URL download.
- The title strip integrates naturally because the composite already includes it before this step. Do NOT draw the title strip outside the frame.
- Tile attribution stays inside the inner composite — the frame doesn't occlude or duplicate it.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- Do NOT introduce a CDN dependency for color picking — use a native <input type="color">.
- Do NOT modify the live map view; this is export-only.
- Frame thickness 0 with frame.enabled = true should produce the same output as frame.enabled = false (defensive).

Deliverables:
- Updated index.html with the Frame controls inside the Export options panel.
- Updated css/styles.css with section styling consistent with existing panel rows.
- Updated js/storage.js with loadExportFrame / saveExportFrame.
- Updated js/app.js with hydration + change wiring.
- Updated js/export.js with the frame composition pass.

Verification:
- Open the app. Frame toggle defaults OFF. Existing exports work unchanged.
- Toggle Frame ON. Pick a 1080² preset. Export. PNG is 1200×1200 (1080 + 2×60), with a 60-px white frame around the map. Title strip is INSIDE the frame.
- Change color to a warm gray (#cccccc). Export. Frame color updates.
- Change thickness to 120. Export. PNG is 1320×1320 with thicker frame.
- Set thickness to 0. Export. PNG is 1080×1080 (no inflation) — defensive equivalence with frame off.
- Enable Soft shadow. Export. The map+title composite has a soft drop shadow within the frame area, the way a printed photo casts a shadow on a card.
- Toggle Frame OFF. Export. Frame is gone; PNG matches the preset dimensions exactly.
- Try with title and subtitle set (NICE-006). Frame surrounds the title strip + map together as one unit.
- Try with the "Current view" preset. Frame extends the composite by the chosen thickness.
- Try with A4 portrait. Frame thickness should still feel right — not crushed by the much larger canvas. (If it doesn't, this is a sign that thickness should also scale with PO-006's coeff — note in the task notes for follow-up.)
- Reload. All four frame settings persist.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- **Why a single object key for persistence?** Four sub-settings × four storage keys = noise in `storage.js`. A single `'city-pin-map.export-frame.v1'` JSON-shaped value is the right granularity, and it's what NICE-006 used for `{ title, subtitle }`.
- **Shadow recipe to start with**: `rgba(0,0,0,0.25)` color, blur ≈ 0.4 × thickness, vertical offset ≈ 0.15 × thickness. These produce a tasteful soft shadow at any thickness without the user thinking about it. If user feedback says the shadow is too harsh, lower the alpha; too subtle, raise it.
- **Possible follow-up parallel to PO-006.** At very large presets (A3 portrait, 2480×3508), a 60-px frame looks proportionally thinner than at 1080². If this is reported as a problem, the right fix is to multiply thickness by PO-006's coeff — same scaling treatment titles get. That's a future enhancement, not v2 scope.
- **Why native color picker?** It's good enough, costs zero bytes, works in every modern browser, and avoids a CDN dependency. Iro.js / Pickr / Spectrum all add 10–60 KB for a feature this isolated doesn't justify.
