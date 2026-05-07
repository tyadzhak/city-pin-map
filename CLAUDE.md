# CLAUDE.md — Instructions for AI Coding Agents

This file is the operating manual for any AI agent working in this repository. Read it before doing anything else.

## Project at a glance

A single-page, no-backend web app that lets the user pin cities on a world map and export the view as a PNG. Runs locally in the browser. See `PROJECT.md` for full scope.

## What's shipped (as of 2026-05-07)

Both Core (CORE-001 → CORE-012) and Nice-to-have (NICE-001 → NICE-007) milestones are `Done`. The app supports:

- Leaflet map with 4 basemap styles (OSM, Carto Light/Dark, OpenTopoMap), switchable from the header.
- Nominatim search with debounce, ≥1 req/sec gating, per-tab cache, and abort-on-newer-keystroke.
- Pin CRUD: add (via search), drag, inline rename, per-pin color picker, delete.
- Groups (NICE-004/005): independent store with name + color, assignable per pin. Group color overrides the pin's own color while assigned. Deleting a group cascades `pin.group → null`.
- Optional connecting polyline ordered by `createdAt` (header toggle).
- PNG export with optional title/subtitle band and 5 size presets (Current view, 1080² square, 1920×1080, A4 portrait, A4 landscape — all 96 dpi).
- Persistence: every preference (pins, groups, map style, route toggle, export text, export format) lives in its own `localStorage` key prefixed `city-pin-map.…v1`.

## Hard rules

1. **No build step.** Plain HTML, CSS, and JavaScript only. No bundlers, no transpilers, no `npm run build`. Libraries are loaded via CDN `<script>` tags.
2. **No backend.** Everything runs client-side. State persists via `localStorage`.
3. **No paid APIs.** Use Leaflet + OpenStreetMap + Nominatim. None require an API key.
4. **Respect Nominatim's usage policy.** Max 1 geocoding request per second, send a meaningful `User-Agent` or `Referer`, and debounce search input.
5. **The app must run by opening `index.html` directly or with a trivial static server** (`python -m http.server`, `npx serve`). If a task requires more than that, stop and flag it.

## File layout (current)

```
city-pin-map/
├── index.html          # Single entry point
├── css/styles.css      # All styles
├── js/
│   ├── app.js          # Bootstrap + glue: wires modules in DOMContentLoaded
│   ├── map.js          # Leaflet init, basemap registry, marker render, drag, route, effectiveColor()
│   ├── geocode.js      # Nominatim wrapper: rate-limit gate, in-tab cache
│   ├── search.js       # Search input → debounced geocode → addPin
│   ├── pins.js         # Pin store: pub/sub, add/remove/update/replaceAll/list
│   ├── pin-list.js     # Side-panel pin list (rename, color, group selector, delete)
│   ├── groups.js       # Group store (mirrors pins.js shape)
│   ├── group-panel.js  # Side-panel group list (always-on rename + color, delete cascades to pins)
│   ├── storage.js      # All localStorage keys + the showError() banner helper
│   └── export.js       # PNG capture, title strip, dimension presets, off-screen render trick
└── assets/             # Reserved for icons/marker images; currently empty
```

Keep modules small and focused. The largest files (`map.js`, `export.js`, `pin-list.js`) sit around 250–310 lines; split when adding new responsibilities, not before.

## Coding conventions

- **Modules:** Use ES modules (`<script type="module">`). Each `js/` file exports named functions.
- **State:** Single in-memory pin store in `pins.js`. UI subscribes to changes via simple pub/sub or by re-reading after each mutation. No frameworks.
- **DOM:** Vanilla `document.querySelector` and event listeners. No jQuery.
- **Async:** `async/await`, never raw `.then()` chains.
- **Errors:** Always show user-visible feedback for failed geocoding, failed exports, etc. Never silently swallow.
- **Comments:** Explain *why*, not *what*. Code should be readable on its own.
- **Naming:** `camelCase` for variables and functions, `PascalCase` for classes (rare here), `kebab-case` for filenames and CSS classes.

## Libraries (load via CDN)

- `leaflet@1.9.4` — map rendering. SRI hash pinned in `index.html`.
- `dom-to-image-more@3.5.0` — PNG export. Locked in (see `index.html` head comment); do not switch to `html-to-image`.

Pin exact versions in `index.html`. Do not introduce new dependencies without a strong reason — note the reason in the task file.

## Pin data model

Every pin must conform to:

```js
{
  id: string,           // crypto.randomUUID()
  name: string,         // user-facing label, defaults to Nominatim display_name
  lat: number,
  lon: number,
  color: string,        // hex like "#e63946" — overridden visually by group color when grouped
  group: string | null, // group id from the group store, or null
  createdAt: number     // Date.now()
}
```

Group entity:

```js
{
  id: string,
  name: string,
  color: string,        // hex
  createdAt: number
}
```

Invariants worth knowing before changing this code:

- A pin's `group` may legitimately reference a now-deleted group at any moment between events; **never crash on stale references**. `effectiveColor()` falls back to the pin's own color, the pin list renders "(none)", and `group-panel.js` cascade-clears the field on group delete.
- `localStorage` is a serializer at save/load points only. The single source of truth during a session is the in-memory pin/group store. Reverse the order at hydrate time and you'll overwrite good data with `[]` — see `attachStorage` notes.
- Hydrate stores **before** subscribing UI renderers, then call the renderer once explicitly to backfill the hydration `notify()`. `app.js` does this in a fixed order; preserve it.

Tasks that touch pins or groups must preserve these shapes. If a task needs a new field, add it as optional and update this section.

## Task workflow

1. Pick a task file from `jira/core/` or `jira/nice-to-have/` whose `Status` is `Todo` and whose dependencies are all `Done`.
2. Set `Status` to `In Progress`.
3. Execute the **Implementation Prompt** at the bottom of the task.
4. Verify against the **Acceptance Criteria** checklist — tick boxes as you go.
5. Set `Status` to `Done` and commit.

## Definition of done

A task is only `Done` when:

- All acceptance criteria checkboxes are ticked.
- The app still loads and runs without console errors.
- No regressions in previously completed tasks.
- Code follows the conventions above.

## What not to do

- Don't add a backend, database, or server-side logic.
- Don't add a build pipeline, even a "small" one.
- Don't introduce React, Vue, or any framework.
- Don't add user accounts, auth, or cloud sync.
- Don't optimize prematurely. The pin count is small (tens, not thousands).
