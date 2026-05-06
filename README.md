# City Pin Map

A locally-running web app for pinning cities on a world map and exporting the result as a PNG image — for personal use like printing, framing, gifting, or scrapbooking travel memories.

## What's in this repository

```
city-pin-map/
├── README.md                       # This file — start here
├── CLAUDE.md                       # Conventions for AI coding agents
├── PROJECT.md                      # Full project scope and tech decisions
└── jira/
    ├── TASK_TEMPLATE.md            # Standard format every task must follow
    ├── core/
    │   ├── GENERATE_TASKS.md       # Prompt → run with an agent to create core tasks
    │   └── *.md                    # Generated task files (CORE-001, CORE-002, …)
    └── nice-to-have/
        ├── GENERATE_TASKS.md       # Prompt → run with an agent to create v2 tasks
        └── *.md                    # Generated task files (NICE-001, NICE-002, …)
```

## How to use this archive

The workflow is two-pass: first generate tasks, then implement them.

### Step 1 — Generate tasks for a milestone

Open a coding agent (Claude Code, Cursor, etc.) in this repo and run the prompt in `jira/core/GENERATE_TASKS.md`. The agent will read `PROJECT.md`, `CLAUDE.md`, and `TASK_TEMPLATE.md`, then create one `.md` file per task inside `jira/core/`.

Repeat with `jira/nice-to-have/GENERATE_TASKS.md` once the core milestone is in good shape.

### Step 2 — Implement a task

Open any generated task file (e.g. `jira/core/CORE-003-city-search.md`). At the bottom of every task is an **Implementation Prompt** section. Hand that prompt to your coding agent and it will do the work.

Update the task's `Status` field as you go: `Todo → In Progress → Done`.

## Running the app locally

Once tasks are implemented, the app runs in any modern browser with no build step:

```bash
# from the project root
python -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

See `PROJECT.md` for the full tech stack and architectural decisions.

## Why this structure?

Splitting "scope → tasks → implementation" into three layers means:

- You can review and reorder tasks before any code is written.
- Each task is small enough to be implemented in one agent session.
- Every task carries its own implementation prompt, so you don't need to re-explain context.
- Milestones are independent, so you can ship core, use the app for a while, then come back for v2.
