# HARDEN-012: MapLibre cutover and cleanup

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-012`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S`                                         |
| **Depends on**  | `HARDEN-008` (PROCEED decision); `HARDEN-009`; `HARDEN-010`; `HARDEN-011` |

## Summary

Final cutover task once HARDEN-009/010/011 are merged. Remove Leaflet entirely from `index.html`, retire `dom-to-image-more`, update `PROJECT.md`'s tech stack table, regression-test every feature, and refresh `CLAUDE.md` (including reversing the "Considered and parked" entry — the parked thing is now Leaflet+raster, not MapLibre+vector).

**Do not start without HARDEN-009/010/011 all `Done`.** This task is the cleanup sweep, not the rewrite.

## Context

This task only runs after the full rewrite is functional. Its job is to clean up dependencies, docs, and confirm zero regressions across the feature surface — which means a real eyes-on regression pass, not just a smoke test.

The dependency removals are non-trivial because both Leaflet and `dom-to-image-more` had SRI hashes pinned (HARDEN-005) — the SRI tags must be removed alongside the script tags, and a stale SRI on a CDN tag the page no longer loads is harmless but confusing.

The CLAUDE.md "Considered and parked" entry written during HARDEN-008 needs to flip: instead of "MapLibre parked, see HARDEN-008 findings," it becomes something like "Leaflet + raster tiles parked. The current vector stack (MapLibre + OpenFreeMap) was chosen in HARDEN-009..012 after the trigger signal materialized: <signal>. Reverting would be ~Nh of work and would lose <vector-only feature>."

## Acceptance criteria

- [ ] No `leaflet@*` references anywhere in the repo (`index.html`, `js/`, docs, comments). `grep -r leaflet` should only hit the closed-and-shipped HARDEN-001..007 task files (historical record, leave them alone).
- [ ] No `dom-to-image-more@*` references. SRI hash from HARDEN-005 removed.
- [ ] `PROJECT.md` "Tech stack" table updated: map rendering = MapLibre GL JS, tiles = OpenFreeMap (and any retained raster providers per HARDEN-011's choice), PNG export = native canvas.
- [ ] `CLAUDE.md` "What's shipped" section reflects the new stack.
- [ ] `CLAUDE.md` "Considered and parked" entry flipped: previous parked thing (MapLibre) → current parked thing (Leaflet + raster). New trigger signals for *un*-parking documented.
- [ ] Full regression pass executed and recorded in this task file's verification notes:
  - Pin add via search (Nominatim still works, debounce still respected)
  - Pin drag (cursor tracking, store update on release)
  - Pin rename (inline edit)
  - Pin color picker
  - Group create / rename / color / assign / delete (cascade still clears `pin.group`)
  - Route polyline toggle and ordering
  - All 7 export presets produce correct images
  - JSON backup and restore round-trip
  - Basemap selection persists across reload
  - Cold-load with empty `localStorage`
- [ ] No console errors during the regression pass.

## Files affected

```
~ index.html                                     (remove Leaflet + dom-to-image-more CDN tags + SRI hashes)
~ PROJECT.md                                     (Tech stack table)
~ CLAUDE.md                                      (operating manual; flip Considered-and-parked)
~ jira/harden/HARDEN-005-sri-hash-dom-to-image.md (note that the SRI'd dependency is now retired)
```

## Out of scope

- Any new features.
- Any changes to functionality not strictly required for the cutover.
- Filing the next round of follow-up tasks (e.g. labels-only-with-pins from PO_review.md). Those are separate tasks; this one is cleanup only.

## Implementation prompt

To be drafted at PROCEED + HARDEN-009/010/011-Done time. The shape will be mostly mechanical (delete CDN tags, update docs, run the regression checklist) — the implementation prompt for this task is the regression checklist itself, expanded with explicit verification steps per feature.
