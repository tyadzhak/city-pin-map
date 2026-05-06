# CLAUDE.md — Instructions for AI Coding Agents

This file is the operating manual for any AI agent working in this repository. Read it before doing anything else.

## Project at a glance

A single-page, no-backend web app that lets the user pin cities on a world map and export the view as a PNG. Runs locally in the browser. See `PROJECT.md` for full scope.

## Hard rules

1. **No build step.** Plain HTML, CSS, and JavaScript only. No bundlers, no transpilers, no `npm run build`. Libraries are loaded via CDN `<script>` tags.
2. **No backend.** Everything runs client-side. State persists via `localStorage`.
3. **No paid APIs.** Use Leaflet + OpenStreetMap + Nominatim. None require an API key.
4. **Respect Nominatim's usage policy.** Max 1 geocoding request per second, send a meaningful `User-Agent` or `Referer`, and debounce search input.
5. **The app must run by opening `index.html` directly or with a trivial static server** (`python -m http.server`, `npx serve`). If a task requires more than that, stop and flag it.

## File layout (target)

```
city-pin-map/
├── index.html          # Single entry point
├── css/styles.css      # All styles
├── js/
│   ├── app.js          # App bootstrap + glue
│   ├── map.js          # Leaflet setup, tile layers, pin rendering
│   ├── geocode.js      # Nominatim wrapper with debounce + rate limit
│   ├── pins.js         # Pin model: add/remove/update/list
│   ├── storage.js      # localStorage save/load
│   └── export.js       # PNG export logic
└── assets/             # Icons, marker images, etc.
```

Keep modules small and focused. If a file grows past ~250 lines, consider splitting.

## Coding conventions

- **Modules:** Use ES modules (`<script type="module">`). Each `js/` file exports named functions.
- **State:** Single in-memory pin store in `pins.js`. UI subscribes to changes via simple pub/sub or by re-reading after each mutation. No frameworks.
- **DOM:** Vanilla `document.querySelector` and event listeners. No jQuery.
- **Async:** `async/await`, never raw `.then()` chains.
- **Errors:** Always show user-visible feedback for failed geocoding, failed exports, etc. Never silently swallow.
- **Comments:** Explain *why*, not *what*. Code should be readable on its own.
- **Naming:** `camelCase` for variables and functions, `PascalCase` for classes (rare here), `kebab-case` for filenames and CSS classes.

## Libraries (load via CDN)

- `leaflet@1.9.x` — map rendering
- `dom-to-image-more` or `html-to-image` — PNG export (pick one and stay consistent)

Pin exact versions in `index.html`. Do not introduce new dependencies without a strong reason — note the reason in the task file.

## Pin data model

Every pin must conform to:

```js
{
  id: string,           // e.g. crypto.randomUUID()
  name: string,         // user-facing label, defaults to geocoded display name
  lat: number,
  lon: number,
  color: string,        // hex like "#e63946"
  group: string | null, // for v2 grouping; null in core
  createdAt: number     // Date.now()
}
```

Tasks that touch pins must preserve this shape. If a task needs a new field, add it as optional and update this section.

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
