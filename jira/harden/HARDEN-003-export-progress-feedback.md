# HARDEN-003: Visible export progress feedback

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-003`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S`                                         |
| **Depends on**  | `None`                                      |

## Summary

Show an inline status near the **Export PNG** button while a preset export is rendering, so the user has visible confirmation that their click registered. Today the button disables itself across `await` but presents no other signal — on a slow connection an A4-portrait export can take 5–10 seconds while tiles re-fetch, which feels like a frozen UI.

## Context

`js/app.js` → `initExportButton()` already disables the button across the `await exportMapAsPng(...)` call (good). What's missing is a positive signal that work is happening.

`js/export.js` has two paths:

- **Fast path** (no title, no subtitle, no preset): captures the live element after `waitForTiles`. Usually instant; no progress signal needed.
- **Framed path** (title strip and/or preset): physically moves the map into an off-screen wrapper, calls `invalidateSize`, waits for tiles, then captures. Can take seconds; this is the path that needs feedback.

The framed path resizes the map to as large as 1920×1080 or A4 dimensions. With `cacheBust: true`, every visible tile is re-fetched. On a typical home connection this is several seconds. The user has no way to know whether they pressed the button or whether the app is broken.

`PROJECT.md` → "Risks and mitigations" already calls out tile-load timing for export. This task is the user-facing complement of that risk: honest about the delay, transparent about progress.

## Acceptance criteria

- [x] During an export, an inline element next to the Export PNG button shows a short status string (e.g. "Rendering…" or "Exporting…").
- [x] The status appears immediately on click and is hidden again as soon as the export completes (success or failure).
- [x] On the fast path (current view, no title, no subtitle), the status appears so briefly it's effectively invisible — but it does not flicker visibly. (One acceptable implementation: only show after a 200 ms delay, so instant exports never flash a label.)
- [x] The status uses the existing error banner's visual style or a simpler unobtrusive styling — must not push other header controls out of position.
- [x] On export failure, the existing error banner still appears; the inline status is cleared.
- [x] The status text is a plain string. No spinner GIFs, no animations beyond a CSS pulse if you want one.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/app.js
~ js/export.js  (only if a callback hook is added — keep it optional)
~ index.html
~ css/styles.css
```

## Out of scope

- Per-stage progress (e.g. "Loading tiles 12/40", "Rendering canvas", "Encoding PNG"). Not worth the wiring; a single "Rendering…" label is enough for the user to know they didn't break anything.
- Cancelling an in-progress export. The button is disabled; the export typically finishes within seconds. Cancellation introduces state-restore bugs (wrapper still in DOM, Leaflet at the wrong size) that aren't worth the risk.
- A determinate progress bar. There's no honest progress signal available — `waitForTiles` knows how many layers fired `load`, not how many tiles are pending — so anything more granular would be theatre.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read this task file in full.

Task: Show inline status feedback while a PNG export is in progress.

Requirements:
- Add an empty <span id="export-status"> next to the Export PNG button in
  index.html. CSS hides it when empty.
- In js/app.js initExportButton, before the await: schedule a 200 ms timer
  that sets the span text to "Rendering…" (so instant exports don't flicker).
  In the finally: clear the timer, blank the span text.
- Style the span as quiet inline text (small, muted color). It must not push
  the Export button out of place when shown.
- Keep js/export.js untouched if possible — the timing-only approach above
  doesn't need a callback.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- Do not introduce a spinner image or animation library. CSS only if any.

Deliverables:
- index.html — add the <span> next to the Export button.
- js/app.js — wire the 200ms-delayed status text.
- css/styles.css — style the span; ensure it does not affect layout when empty.

Verification:
- Pin a few cities, pick the A4-portrait preset, click Export PNG. Confirm
  "Rendering…" appears within ~½ second and disappears as soon as the
  download starts.
- Pick "Current view" with no title/subtitle and click Export PNG. Confirm
  no "Rendering…" flash on a fast path.
- Disconnect from the network briefly mid-export; confirm the existing error
  banner appears and the inline status is cleared.
- All acceptance criteria in this task file are satisfied.

When finished:
- Update this task file's Status field to `Done` and tick every acceptance
  criteria checkbox.
- Create a feature branch `harden-003-export-progress-feedback`.
- Commit with message
  `HARDEN-003: inline rendering status while exporting PNG` and the
  Co-Authored-By footer matching this repo's commit style.
- Push the branch and open a pull request titled
  `HARDEN-003: inline rendering status while exporting PNG` against `main`.
```

## Notes

- The 200 ms delay before showing the label is a deliberate UX choice borrowed from the "Nielsen Norman" guideline that anything under ~200 ms feels instant and shouldn't be annotated.
