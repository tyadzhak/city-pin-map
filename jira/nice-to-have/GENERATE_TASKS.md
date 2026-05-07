# GENERATE_TASKS — Nice-to-have Milestone

This file is a prompt. Run it with a coding agent (Claude Code, Cursor, Aider, etc.) from the repository root **only after the Core milestone is complete**. The agent will produce one task file per task inside `jira/nice-to-have/`, all following `jira/TASK_TEMPLATE.md`.

After running this prompt, review the generated files, reorder or merge as needed, then start implementing them one by one.

---

## Prompt

```
You are an AI agent helping plan the Nice-to-have milestone of the city-pin-map project.

Precondition — verify that the Core milestone is in a working state. Spot-check a few task files in jira/core/ and confirm their Status fields are "Done". If most Core tasks are still "Todo", stop and warn the user that the Nice-to-have milestone depends on the Core foundation.

Step 1 — Read these files in full before doing anything else:
  - README.md
  - CLAUDE.md
  - PROJECT.md
  - jira/TASK_TEMPLATE.md
  - Skim jira/core/ to understand what already exists, what files have been created, and what conventions have been established.

Step 2 — Break the Nice-to-have milestone (defined in PROJECT.md under "Milestones → Nice-to-have") into a sequence of small, independently implementable tasks. Aim for 6–10 tasks total. Each task should be sized S or M (≤3 hours of focused work). Split anything larger.

Coverage requirement — the resulting task set, taken together, must deliver every Nice-to-have feature listed in PROJECT.md:
  - Connecting lines between pins (travel route visualization)
  - Custom title and subtitle text rendered into the exported image
  - Multiple map styles (minimalist light, dark, vintage/sepia, etc.) with a switcher in the UI
  - Adjustable export dimensions and aspect ratio (square, A4/A3 print, 16:9, etc.)
  - Drag pins to fine-tune their position on the map
  - Group pins (by trip or theme) with per-group colors

Step 3 — For each task, create a file at:
  jira/nice-to-have/NICE-{NNN}-{kebab-case-title}.md

Number tasks sequentially starting at NICE-001 in a sensible implementation order (lower-risk and lower-dependency tasks first). Use the structure defined in jira/TASK_TEMPLATE.md exactly — every section present, every table field filled in.

Step 4 — Quality bar for each task file:

  - Summary is one or two sentences focused on the outcome, not the steps.
  - Context references concrete sections of CLAUDE.md, PROJECT.md, and the relevant Core task files where applicable. (For example, "extends the export feature delivered in CORE-009".)
  - Acceptance criteria are observable behaviors, not implementation details.
  - "Files affected" lists every file the task creates or modifies, with + or ~ prefixes. Most v2 tasks will modify Core files rather than create new ones — be honest about that.
  - "Depends on" must include the relevant Core task IDs where applicable, plus any earlier Nice-to-have tasks.
  - The Implementation prompt at the bottom is self-contained: a fresh agent reading only that prompt plus the repo should be able to complete the task. It must remind the agent to read CLAUDE.md and PROJECT.md, list concrete requirements, list deliverable files, and describe how to verify the result.
  - Respect the Hard Rules in CLAUDE.md. If a v2 feature genuinely needs an exception (for example, a new lightweight dependency), call that out explicitly in the task's Notes section so the human can approve before implementation begins.
  - Pay attention to the data model: any new pin field (such as `group`) must be additive and backward-compatible with pins already saved in localStorage. Spell that out in the relevant task.

Step 5 — After creating all task files, append a short summary to this file (jira/nice-to-have/GENERATE_TASKS.md) under a new "## Generated tasks" section, listing each task ID, title, and one-line summary, in implementation order. This gives the human reviewer a quick index.

Do not implement any of the tasks themselves. Your job is only to produce the planning artifacts.
```

---

## Generated tasks

Generated 2026-05-07. Listed in the recommended implementation order — lower-risk and lower-dependency first, with the two interrelated pairs (groups, export) kept adjacent so context isn't lost between them.

1. **NICE-001 — Drag pins to fine-tune position.** Make existing markers draggable; on drop, persist new lat/lon via the pin store. Isolated to `js/map.js`.
2. **NICE-002 — Multiple map styles with switcher.** Header dropdown of free, key-free tile providers (OSM, Carto Light, Carto Dark, Topographic). Persists choice and applies on reload.
3. **NICE-003 — Connecting lines between pins.** Optional polyline drawn through all pins in `createdAt` order with a header toggle; updates live, included in PNG export.
4. **NICE-004 — Group data model and management panel.** New group store + side-panel UI for create / rename / recolor / delete. Pins are not yet assigned (NICE-005). New `'city-pin-map.groups.v1'` storage key, separate from pins.
5. **NICE-005 — Assign pins to groups and render with group color.** Per-pin group selector; effective marker / swatch color resolves through the group store; group deletion cascades pins back to ungrouped.
6. **NICE-006 — Custom title and subtitle in exported image.** Two text inputs in an Export options panel; values are baked into the captured PNG above the map without altering the live view; persisted across reloads.
7. **NICE-007 — Adjustable export dimensions and aspect ratio.** Format preset selector (Current view, Square, 16:9, A4 portrait/landscape) added to the Export options panel; resizes the capture target, waits for tiles, captures, then restores the on-screen map.

Coverage check vs. PROJECT.md → "Nice-to-have":

- Connecting lines between pins → **NICE-003**
- Custom title and subtitle text rendered into the exported image → **NICE-006**
- Multiple map styles with a switcher → **NICE-002**
- Adjustable export dimensions and aspect ratio → **NICE-007**
- Drag pins to fine-tune position → **NICE-001**
- Group pins with per-group colors → **NICE-004** (groups) + **NICE-005** (assignment + rendering)

All six Nice-to-have features are covered by exactly one or (for grouping) two tasks. No existing CDN dependency is added or swapped — all tasks stay within the `CLAUDE.md` → "Hard rules" boundary.
