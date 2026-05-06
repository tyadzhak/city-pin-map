# CORE-001: Project scaffolding

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-001`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | None                                        |

## Summary

Create the empty directory layout, the single `index.html` entry point with CDN imports pinned, base CSS, and stub ES modules so every later task has a place to plug into. Opening `index.html` should produce a visible app shell with no console errors.

## Context

This is the foundation task for the entire Core milestone. The file layout, naming conventions, and "no build step" constraint are defined in `CLAUDE.md` ("File layout (target)", "Coding conventions", "Hard rules"). The libraries to load via CDN are listed in `CLAUDE.md` under "Libraries". The app shell (header with search area, map area, side panel for pins) is what every subsequent UI task will attach to.

Pinned versions matter: `CLAUDE.md` requires exact versions in `index.html` so the app's behavior doesn't drift if a CDN ships a new release.

## Acceptance criteria

- [ ] Opening `index.html` directly in a browser shows the app shell (header, map area, side panel) with no console errors.
- [ ] `index.html` loads `leaflet@1.9.x` CSS and JS from a CDN, and `html-to-image` (or `dom-to-image-more`) from a CDN, both at pinned versions.
- [ ] `index.html` loads `js/app.js` as `<script type="module">`.
- [ ] The directory tree matches the "File layout (target)" section of `CLAUDE.md` exactly: `css/styles.css`, `js/app.js`, `js/map.js`, `js/geocode.js`, `js/pins.js`, `js/storage.js`, `js/export.js`, `assets/`.
- [ ] Each `js/*.js` file exists and exports at least one named placeholder so other modules can import without 404s.
- [ ] Base CSS sets a sensible page reset, fills the viewport, and visually separates the three shell regions (header, map, side panel).
- [ ] No regressions in previously completed tasks.
- [ ] No errors in browser console.

## Files affected

```
+ index.html
+ css/styles.css
+ js/app.js
+ js/map.js
+ js/geocode.js
+ js/pins.js
+ js/storage.js
+ js/export.js
+ assets/.gitkeep
```

## Out of scope

- No actual Leaflet map rendering yet — just the empty `<div id="map">` container. (Covered by CORE-002.)
- No working search, pins, storage, or export. Stub modules only.
- No icons or marker images in `assets/` yet — the directory exists for later tasks.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Pay particular attention to the "Hard rules", "File layout (target)", "Coding conventions", and "Libraries" sections of CLAUDE.md.

Task: Scaffold the project so that opening index.html in a browser produces an empty but well-structured app shell, with all module files stubbed out and CDN dependencies pinned.

Requirements:
- Create the exact directory tree listed in CLAUDE.md → "File layout (target)".
- index.html must:
  - Be a complete HTML5 document with <meta charset="utf-8"> and <meta name="viewport" content="width=device-width, initial-scale=1">.
  - Include Leaflet 1.9.x CSS and JS from a public CDN (e.g. unpkg.com) at pinned versions.
  - Include html-to-image (or dom-to-image-more) from a CDN at a pinned version. Pick one library and stay consistent for the rest of the project — record the choice in a top-of-file HTML comment.
  - Load /js/app.js as <script type="module"> at the bottom of <body>.
  - Render a three-region shell: a top header (where search will live), a main map area containing <div id="map">, and a side panel (where the pin list will live). Use plain semantic HTML.
- css/styles.css must:
  - Reset default margins, set html and body to fill the viewport, and use a clean system font stack.
  - Lay out the three shell regions so the map fills the available space and the side panel has a fixed width on desktop. Mobile is not a target (PROJECT.md, "Out of scope").
- Each js/*.js file must export at least one named placeholder symbol so future imports compile. js/app.js should be the bootstrap: it imports the other modules and runs an `init()` function on DOMContentLoaded that, for now, just logs a startup message.

Constraints:
- Follow the hard rules in CLAUDE.md: no build step, no backend, no frameworks, no paid APIs.
- Use ES modules everywhere (CLAUDE.md → "Coding conventions").
- Use kebab-case filenames, camelCase identifiers.
- Pin every CDN version exactly. No "latest" tags.

Deliverables:
- index.html — entry point with CDN imports and shell markup.
- css/styles.css — base styles and shell layout.
- js/app.js — bootstrap that imports stubs and calls init() on DOMContentLoaded.
- js/map.js, js/geocode.js, js/pins.js, js/storage.js, js/export.js — each exports a named placeholder.
- assets/.gitkeep — empty file so the directory survives in git.

Verification:
- Open index.html directly (file://) in Chrome and Firefox. The shell renders, the console is silent, and the map area is a visible empty box.
- Run `python -m http.server` from the repo root and load http://localhost:8000. Same result.
- Network tab shows the CDN scripts and stylesheets returning 200, all at pinned versions.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Pick **one** PNG-export library at this stage and write the choice into the top-of-file comment in `index.html` and `js/export.js`. CORE-012 will assume that choice. `html-to-image` is the lighter-weight option; `dom-to-image-more` has slightly better Leaflet compatibility — either is fine.
