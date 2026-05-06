# Task Template

This is the standard format every task file in `jira/core/` and `jira/nice-to-have/` must follow. When a task generation prompt is run, it produces one file per task using exactly this structure.

**Filename convention:** `{MILESTONE}-{NNN}-{kebab-case-title}.md`
Examples: `CORE-001-project-scaffolding.md`, `NICE-003-map-style-switcher.md`

---

# {ID}: {Title}

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-001` or `NICE-001`                    |
| **Milestone**   | `Core` or `Nice-to-have`                    |
| **Status**      | `Todo` / `In Progress` / `Done`             |
| **Priority**    | `High` / `Medium` / `Low`                   |
| **Estimate**    | `S` (≤1h) / `M` (1–3h) / `L` (3–6h)         |
| **Depends on**  | List of task IDs, or `None`                 |

## Summary

One or two sentences describing what this task delivers and why it matters. A reader should understand the *outcome* without scrolling further.

## Context

Any relevant background: which file(s) this task touches, which previous tasks it builds on, design decisions already made elsewhere. Reference `PROJECT.md` and `CLAUDE.md` sections by name where useful.

## Acceptance criteria

A checklist that defines "done." Each item is a verifiable behavior, not an implementation detail.

- [ ] Criterion 1 — observable behavior
- [ ] Criterion 2 — observable behavior
- [ ] Criterion 3 — observable behavior
- [ ] No regressions in previously completed tasks
- [ ] No errors in browser console

## Files affected

List the files this task is expected to create or modify. Use `+` for new, `~` for modified.

```
+ js/example.js
~ index.html
~ css/styles.css
```

## Out of scope

What this task explicitly does *not* cover, to prevent scope creep. Note follow-up tasks if relevant.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained: the agent should be able to do the work using only this prompt plus the repo contents.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope.

Task: {short restatement of the task goal}

Requirements:
- {Concrete requirement 1}
- {Concrete requirement 2}
- {Concrete requirement 3}

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- {Any task-specific constraints}

Deliverables:
- {File 1 with brief description of contents}
- {File 2 with brief description of contents}

Verification:
- {How to manually check it works, e.g. "open index.html, search for 'Tokyo', confirm a pin appears at the correct location"}
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Anything else worth recording: open questions, decisions deferred, links to references, screenshots, etc. Optional.
