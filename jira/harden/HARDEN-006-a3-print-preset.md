# HARDEN-006: A3 export preset

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-006`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `Low` (stretch)                             |
| **Estimate**    | `S`                                         |
| **Depends on**  | `NICE-007`                                  |

## Summary

Add an A3 portrait and A3 landscape preset to the export-format selector. NICE-007 already shipped A4 at 96 dpi; A3 is the natural sibling for users who want a larger printed poster. This is a one-line addition to `EXPORT_PRESETS` plus two `<option>` rows.

## Context

`js/export.js` → `EXPORT_PRESETS` is the single source of truth for the dropdown's behaviour:

```js
export const EXPORT_PRESETS = {
  current: null,
  square: { width: 1080, height: 1080 },
  "16x9": { width: 1920, height: 1080 },
  "a4-portrait": { width: 794, height: 1123 },
  "a4-landscape": { width: 1123, height: 794 },
};
```

A3 at 96 dpi is `1191 × 1684` portrait, inverse for landscape. NICE-007 already documented why 96 dpi is the right default (cacheBust + tile re-fetch overhead at 300 dpi makes exports painfully slow on consumer connections). A3 inherits that same tradeoff — and is more vulnerable to it because the tile count grows with area. Reuse the existing `TILE_WAIT_TIMEOUT_MS_PRESET` (12 s) without bumping it; if A3 exports turn out to time out on slow connections, that's a focused follow-up, not part of this task.

`index.html` has the matching `<option>` list under `<select id="export-format">`. Keep the order grouped by family: 1:1, 16:9, A4 portrait, A4 landscape, A3 portrait, A3 landscape.

## Acceptance criteria

- [ ] `EXPORT_PRESETS` in `js/export.js` includes `a3-portrait: { width: 1191, height: 1684 }` and `a3-landscape: { width: 1684, height: 1191 }`.
- [ ] `index.html` has two new `<option>` rows below the A4 ones, with values matching the new preset ids and labels `"A3 portrait (1191×1684)"` and `"A3 landscape (1684×1191)"`.
- [ ] Selecting either A3 preset and clicking Export PNG produces a PNG whose dimensions match within 1 px tolerance.
- [ ] The chosen preset persists across reloads (already handled by `loadExportFormat` / `saveExportFormat`).
- [ ] All previously shipped presets still work identically.
- [ ] No errors in browser console.

## Files affected

```
~ js/export.js
~ index.html
```

## Out of scope

- 300 dpi A3 (`3508 × 4961`). Same reasoning as NICE-007's 300 dpi rejection — `cacheBust` makes large tile re-fetches slow on home connections. Not worth the wait for the marginal print quality difference.
- Custom user-entered dimensions. NICE-007 explicitly deferred this; HARDEN-006 does not revisit it.
- Print-DPI metadata in the PNG. The exported file is bytes; no app reads embedded DPI for sizing — print software lets the user pick paper size at print time.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read this task file in full.

Task: Add A3 portrait and A3 landscape presets to the export-format selector.

Requirements:
- Add two entries to EXPORT_PRESETS in js/export.js:
    "a3-portrait": { width: 1191, height: 1684 }
    "a3-landscape": { width: 1684, height: 1191 }
- Add two <option> rows in index.html below the A4 options, values
  "a3-portrait" and "a3-landscape", labels matching the existing A4 style.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Do not change any other preset, do not introduce a DPI selector, do not
  raise the tile-wait timeout.

Deliverables:
- js/export.js with the two new entries.
- index.html with the two new <option> rows.

Verification:
- Pin a few cities. Pick "A3 portrait" from the format selector, click
  Export PNG. Open the resulting file; confirm it is 1191×1684 px.
- Repeat for "A3 landscape" — confirm 1684×1191 px.
- Reload the page; confirm the last-picked format is still selected.
- Pick "Current view" and Export — confirm CORE-012 fast-path behaviour
  is unchanged.
- All acceptance criteria in this task file are satisfied.

When finished:
- Update this task file's Status field to `Done` and tick every acceptance
  criteria checkbox.
- Create a feature branch `harden-006-a3-print-preset`.
- Commit with message `HARDEN-006: A3 portrait and landscape export presets`
  and the Co-Authored-By footer matching this repo's commit style.
- Push the branch and open a pull request titled
  `HARDEN-006: A3 portrait and landscape export presets` against `main`.
```

## Notes

- If A3 exports start timing out at 12 s on real-world connections, the right fix is a separate task to bump `TILE_WAIT_TIMEOUT_MS_PRESET` (or make it preset-aware), not folding that decision into this one.
