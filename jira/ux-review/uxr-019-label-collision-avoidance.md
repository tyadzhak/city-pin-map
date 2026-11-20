# UXR-019: Pin labels overlap and become unreadable in clusters

| Field           | Value                |
|-----------------|----------------------|
| **ID**          | `UXR-019`            |
| **Milestone**   | `UX review`          |
| **Status**      | `Done`               |
| **Severity**    | `Medium`             |
| **Priority**    | `Medium`             |
| **Depends on**  | None                 |

## Summary

Labels always sat 1em below their pin, so pins in a dense cluster stacked their names into an unreadable pile.

## Context

**Files:** `js/label-layout.js` (new, pure), `js/label-layout.test.mjs` (new), `js/map-labels.js`

- `computeLabelSpecs` is the single source of truth for live (main + inset) and export labels.

## Failure scenario

Venice, Padua, Verona and Vicenza at zoom 5: the names printed over each other and could not be read.

## Fix direction

New DOM-free `layoutLabels()` does deterministic greedy placement in `createdAt` order. Un-dragged labels try below, above, right, left, below-right, below-left, above-right, above-left and take the first box clear of placed labels and pin-icon boxes, falling back to below. Labels with a non-zero `labelDx`/`labelDy` are fixed obstacles and never move. Text width comes from an injected `measure` (canvas `measureText` in `map-labels.js`); label size, icon size and gaps are all pre-multiplied by `sizeMultiplier`, so export arranges labels like the live view. It re-runs wherever `computeLabelSpecs` runs (move/zoom reposition, render, export).

## Acceptance criteria

- [x] Clustered labels no longer overlap where an alternative exists. *(Node test plus Playwright smoke: 0 overlapping label rects at zoom 5 and 7.5.)*
- [x] Manually dragged labels are untouched. *(Node test; smoke seeded Vicenza with labelDx/labelDy.)*
- [x] Export matches live. *(Same `computeLabelSpecs` path with scaled inputs; scaling covered by a node test. Export PNG not run.)*
- [x] Tests pass. *(`node --test js/*.test.mjs`.)*
