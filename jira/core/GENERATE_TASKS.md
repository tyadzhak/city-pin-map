# GENERATE_TASKS — Core Milestone

This file is a prompt. Run it with a coding agent (Claude Code, Cursor, Aider, etc.) from the repository root. The agent will produce one task file per task inside `jira/core/`, all following `jira/TASK_TEMPLATE.md`.

After running this prompt, review the generated files, reorder or merge as needed, then start implementing them one by one.

---

## Prompt

```
You are an AI agent helping plan the Core milestone of the city-pin-map project.

Step 1 — Read these files in full before doing anything else:
  - README.md
  - CLAUDE.md
  - PROJECT.md
  - jira/TASK_TEMPLATE.md

Step 2 — Break the Core milestone (defined in PROJECT.md under "Milestones → Core") into a sequence of small, independently implementable tasks. Aim for 8–14 tasks total. Each task should be sized S or M (≤3 hours of focused work). Split anything larger.

Coverage requirement — the resulting task set, taken together, must deliver every Core feature listed in PROJECT.md:
  - Project scaffolding (index.html, folder layout, CDN imports, base styles)
  - Interactive Leaflet map with pan/zoom
  - City search input with Nominatim geocoding (debounced, rate-limited)
  - Adding a pin from a search result
  - Pin list panel UI
  - Removing a pin
  - Renaming a pin's label
  - Choosing a pin's color
  - Exporting the current map view as a PNG (with attribution preserved)
  - Saving and loading pin sets via localStorage

Step 3 — For each task, create a file at:
  jira/core/CORE-{NNN}-{kebab-case-title}.md

Number tasks sequentially starting at CORE-001 in implementation order (so dependencies always point to lower-numbered tasks). Use the structure defined in jira/TASK_TEMPLATE.md exactly — every section present, every table field filled in.

Step 4 — Quality bar for each task file:

  - Summary is one or two sentences focused on the outcome, not the steps.
  - Context references concrete sections of CLAUDE.md or PROJECT.md where relevant.
  - Acceptance criteria are observable behaviors (e.g. "typing 'Tokyo' and pressing Enter places a pin at Tokyo's coordinates"), not implementation details ("function called X exists").
  - "Files affected" lists every file the task creates or modifies, with + or ~ prefixes.
  - "Depends on" is filled in honestly — if a task can't start until another is done, say so.
  - The Implementation prompt at the bottom is self-contained: a fresh agent reading only that prompt plus the repo should be able to complete the task. It must remind the agent to read CLAUDE.md and PROJECT.md, list concrete requirements, list deliverable files, and describe how to verify the result.
  - Respect the Hard Rules in CLAUDE.md — no build steps, no backend, no frameworks, no paid APIs.

Step 5 — After creating all task files, append a short summary to this file (jira/core/GENERATE_TASKS.md) under a new "## Generated tasks" section, listing each task ID, title, and one-line summary, in implementation order. This gives the human reviewer a quick index.

Do not implement any of the tasks themselves. Your job is only to produce the planning artifacts.
```

---

## Generated tasks

Twelve tasks, all sized `S` or `M`, in strict implementation order. Each task's `Depends on` field points only to earlier-numbered tasks, so this list doubles as a build sequence.

| ID         | Title                                        | One-line summary                                                                                  |
|------------|----------------------------------------------|---------------------------------------------------------------------------------------------------|
| CORE-001   | Project scaffolding                          | Create `index.html`, folder layout, pinned CDN imports, base CSS, and stub ES modules.            |
| CORE-002   | Interactive Leaflet map with pan and zoom    | Initialize a Leaflet map with OSM tiles in `#map`, with attribution preserved.                    |
| CORE-003   | In-memory pin store with pub/sub             | Build the canonical pin store in `js/pins.js` with `add/remove/update/list/subscribe`.            |
| CORE-004   | localStorage persistence                     | Auto-save pin changes and restore the pin set across reloads via `js/storage.js`.                 |
| CORE-005   | Render pins as markers on the map            | Subscribe `js/map.js` to the pin store; markers reflect color and tooltips reflect name.          |
| CORE-006   | Nominatim geocoding wrapper                  | Debounce-friendly, rate-limited, cancellable, in-session-cached geocoder in `js/geocode.js`.      |
| CORE-007   | City search input and adding a pin           | Header search field with debounced suggestions; selecting one adds a pin via the store.           |
| CORE-008   | Pin list panel UI                            | Side-panel list of pins with color swatch and name, re-rendering on every store change.           |
| CORE-009   | Remove a pin from the list                   | Per-row delete button that calls `removePin`; map and list update automatically.                  |
| CORE-010   | Rename a pin's label                         | Inline rename UI on each row; commits via `updatePin`, cascades to map tooltip and storage.       |
| CORE-011   | Choose a pin's color                         | Per-row native `<input type="color">` picker that updates the pin's hex color.                    |
| CORE-012   | Export current map view as PNG               | "Export PNG" button that captures the map (waiting for tiles, preserving attribution).            |
