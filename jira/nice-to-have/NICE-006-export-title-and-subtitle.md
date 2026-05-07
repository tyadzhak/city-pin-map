# NICE-006: Custom title and subtitle in exported image

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `NICE-006`                                  |
| **Milestone**   | `Nice-to-have`                              |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `CORE-004`, `CORE-012`                      |

## Summary

Let the user enter a title and subtitle that are baked into the exported PNG (e.g. `"Italy 2024" / "September — Rome, Florence, Venice"`). The text appears in the captured image only — never on the working map view — so it doesn't compete with the live UI. After this task the exported image is presentation-ready for printing or gifting without external editing.

## Context

`PROJECT.md` → "Nice-to-have" lists "Custom title and subtitle text rendered into the exported image." `PROJECT.md` → "Goal" reframes the export as the product itself, so making the PNG self-contained (with title) directly serves the project's success criterion.

CORE-012 (`js/export.js` → `exportMapAsPng`) currently captures `mapInstance.getContainer()` as-is. This task expands the capture target to include a title strip while keeping the live map viewport unchanged: the strip is constructed at export time, captured alongside the map, and removed afterwards so the user's working view doesn't shift.

The title and subtitle inputs are user preferences that should survive a page refresh (the user often iterates on a map across sessions before exporting), so they persist via `localStorage` with their own keys, following the pattern from CORE-004 / NICE-002.

## Acceptance criteria

- [ ] An "Export options" area in the header (or a small expandable panel near the Export PNG button) contains a title text input and a subtitle text input. Both are visible without extra clicks once revealed.
- [ ] Typing into title or subtitle does NOT change the live map view — the text is for export only.
- [ ] Clicking "Export PNG" produces a PNG that contains the live map view PLUS the title and subtitle rendered above (or in a clearly defined band — top is the natural choice).
- [ ] The OSM/tile attribution remains visible in the exported image (per `PROJECT.md` → "Risks and mitigations"); it is not displaced or covered by the title strip.
- [ ] If both title and subtitle are empty, the exported image looks identical to a CORE-012 export (no empty strip, no whitespace band, no behavior change).
- [ ] If only title is set, the strip renders only the title; if only subtitle is set, the strip renders only the subtitle. Neither shows a phantom empty line.
- [ ] Title and subtitle persist across reloads.
- [ ] Title and subtitle are typographically presentable: a clean serif or sans-serif, comfortably sized (e.g. ~28–36 px title, ~16–20 px subtitle for the default export resolution), with sensible line-height and color contrast against a plain background band (white or matching the chosen map style).
- [ ] After export completes (or fails), the live map view is unchanged — no leftover DOM nodes, no shifted viewport, no broken Leaflet sizing.
- [ ] The text inputs are keyboard-accessible.
- [ ] No regressions in previously completed tasks.
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

- Per-export font choice, weight, color, alignment beyond a tasteful default. Custom typography is a future task.
- WYSIWYG preview of the exported image inside the page. The PNG itself is the preview.
- Multi-line / rich-text titles (HTML formatting, links, emoji rendering nuances).
- Watermarks, logos, or signature lines (separate concern).

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md, and re-read js/export.js (CORE-012) and the index.html top-of-file note about the chosen export library (dom-to-image-more).

Task: Render an optional title + subtitle into the exported PNG without changing the on-screen map view.

Requirements:

UI (index.html, css/styles.css):
- Add a small "Export options" panel near the Export PNG button. It contains:
  - <input type="text" id="export-title" placeholder="Title (optional)" />
  - <input type="text" id="export-subtitle" placeholder="Subtitle (optional)" />
- Style the panel so it sits beside or below the existing Export PNG button without breaking the header layout.
- The two inputs are visible (or one click away if you choose a collapsible panel) — keep it simple.

Persistence (js/storage.js):
- Add `loadExportText()` → `{ title: string, subtitle: string }` (defaults `{ title: '', subtitle: '' }`).
- Add `saveExportText({ title, subtitle })`. Use storage key `'city-pin-map.export-text.v1'`. Apply the same try/catch + showError + corruption-tolerant pattern as loadPins/savePins.

App wiring (js/app.js):
- On bootstrap, hydrate the two inputs from `loadExportText()`.
- On `input` (or debounced `change`) of either field, call `saveExportText({ title, subtitle })`.

Export (js/export.js):
- Modify `exportMapAsPng(mapInstance)`. The new flow:
  1. Read the current title + subtitle from the inputs (or accept them as parameters; either is fine — choose one and stay consistent in the call site in app.js).
  2. If both are empty, behave exactly as today (capture mapInstance.getContainer() as-is). This preserves the CORE-012 behavior unchanged.
  3. Otherwise:
     a. Build a temporary wrapper `<div class="export-frame">` containing a title strip element followed by the map's parent container — but since detaching/reattaching the map node from Leaflet is risky, prefer this approach: dynamically inject a positioned `<div class="export-title-strip">` as a sibling of the map's container inside a transient parent. The cleanest technique:
        - Create a wrapper div, position it absolutely off-screen (e.g. left: -10000px), give it a fixed background (white).
        - Clone the map element via `mapInstance.getContainer().cloneNode(true)` for the off-screen render — but cloned Leaflet tiles will not render correctly, so do NOT use a clone.
        - Instead: temporarily wrap the live map container with a parent that includes the title strip, capture that parent, then unwrap. dom-to-image-more captures the live DOM, so wrapping/unwrapping in place is safe as long as it is undone in a `finally`.
     b. Render the title strip with the title in a larger weight and the subtitle in a smaller weight beneath it. If only one is set, render only that one (no empty paragraph). Pick a clean default font available on macOS, Windows, and most Linux distros (e.g. system UI font or a common serif like Georgia).
     c. Wait for tiles via the existing waitForTiles helper, then call `domtoimage.toPng(wrapperElement, { cacheBust: true })`.
     d. In a `finally` block, undo the wrapping so the live page DOM is restored exactly as it was. The map's Leaflet state must not be disturbed (no resize, no invalidateSize on the live map during this).
  4. Trigger the existing download path with the captured data URL.
- Make sure the on-screen map's pixel dimensions, scroll position, and Leaflet internal state are unchanged after the export completes (success OR failure).
- Keep the OSM attribution control visible inside the wrapper — do NOT use a `filter` option that strips controls.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Do not switch the export library — stay on dom-to-image-more (per index.html top comment).
- Do not introduce a new CDN dependency for typography.
- The user's live working map must NOT visibly shift, resize, or flicker because of the title strip. The wrap/unwrap approach above keeps the wrapper detached or off-screen so this is invisible to the user; verify in your browser.

Deliverables:
- Updated index.html with title + subtitle inputs.
- Updated css/styles.css with input styling AND export-title-strip styling (used at capture time).
- Updated js/storage.js with loadExportText / saveExportText.
- Updated js/app.js with hydration + persistence wiring.
- Updated js/export.js with the wrapping logic.

Verification:
- Open the app. Add three pins.
- Leave title and subtitle empty. Click Export PNG. The image is identical to a CORE-012 export — no empty strip, same dimensions.
- Type "Italy 2024" as title and leave subtitle empty. Export. The image now has "Italy 2024" rendered above the map. No phantom subtitle line.
- Add subtitle "September trip". Export. Both lines appear, title larger.
- Refresh. Both inputs still show their previous values.
- Confirm the live map looks exactly the same after each export — no resize, no flicker.
- Inspect the exported PNG: OSM attribution is still visible at the bottom-right; the title strip background does not bleed into the map area; tiles are present (no grey gaps).
- Trigger an export failure (e.g. set title, then break the export by temporarily commenting out the dom-to-image-more script tag) — the error banner shows a message, the wrapper is cleanly removed, the live map still works.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

The wrapping technique relies on `dom-to-image-more` capturing the live DOM, including the map. The trick is to wrap *in place* (the wrapper temporarily becomes the parent of the existing map container) so Leaflet's internal references stay valid. Cloning the map node would break tile rendering. Always undo the wrap in a `finally` block so a thrown error never leaves the DOM in a half-wrapped state.

A future refinement (NICE-007) introduces resize / aspect-ratio controls in the same Export options panel. Keep the panel layout extensible so adding a third control row later is trivial.
