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

*(This section is filled in by the agent after running the prompt above.)*
