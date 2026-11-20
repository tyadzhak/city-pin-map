# UXR-032 — UX-review round follow-ups

- **ID:** UXR-032
- **Milestone:** UX review
- **Status:** Done
- **Severity/Priority:** Low

## Summary
Cleanup PR folding the small follow-ups recorded while merging UXR-001…031.

## Context (files)
`index.html`, `css/styles.css`, `js/search.js`, `js/search.test.mjs`, `js/app.js`, `test/coverage/scenarios/00-boot-and-broad.mjs`.

## Failure scenario
1. Frame padding/margin tooltips described a mat model that no longer exists.
2. Scenario 00 waited 10 s for a row in a hidden tab panel.
3. With "Hide map labels" on and a raster basemap, the notice wrapped to ~100px tall at 800px and overflowed the 56px header.
4. The per-line title font select truncated to "Georg".
5. Pinning "Paris" (France) badged "Paris, Texas" as already pinned.
6. Restoring an empty checkpoint said "Loaded an empty snapshot."
7. `js/file-menu.js` had ~39% browser coverage.

## Fix direction
1. Tooltips now say padding is a transparent gap inside the band and margin insets the band from the map edge.
2. `waitForSelector(..., { state: "attached" })`.
3. `.hide-labels-notice` is nowrap + ellipsis, `min-width:0`, `flex: 0 1 auto`, with the full text in a `title`.
4. `.otm-line-controls` wraps; the font select has `flex: 1 1 116px; min-width: 116px`.
5. `isAlreadyPinned`: within 2 km regardless of name, OR same name within 50 km. Tests updated.
6. Wording: "The saved checkpoint is empty — nothing to restore." / "Restored N pins…" (partial-failure variant adjusted too).
7. New scenario step in 00: ArrowDown/ArrowUp/Home/End, Escape returns focus, outside click closes.

## Acceptance criteria
- [x] Tooltips reworded (index.html, 4 inputs).
- [x] Scenario 00 wait uses `state: "attached"`.
- [x] Notice at 800/1024 px with a raster style: Playwright shows height 25px (was 103px at 800), header stays 56px, no horizontal scroll.
- [x] Title font select 173px wide at 1024 (was ~78px).
- [x] `isAlreadyPinned` rule + test; `node --test js/*.test.mjs` 478/478 pass.
- [x] Checkpoint wording updated; no tests asserted the old text.
- [x] File-menu scenario step added; see PR for `coverage:all` result.
