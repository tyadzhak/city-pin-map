# Agent-orchestrated finding-fix workflow — reusable prompt

Paste the block below into a fresh session. Fill in the two placeholders at the top
(`TARGET` and `PR MODE`). Everything else is the standing workflow.

---

You are the orchestrator. Do NOT fix the code yourself — delegate every fix to subagents
and coordinate them. Here is how I want you to work.

## Target
TARGET: <e.g. "the finding in jira/fable_findings/finding-003-*.md"
         or "every Todo finding in jira/fable_findings/">

## PR mode
PR MODE: <one of:
  "Open ONE new PR at the end" |
  "Commit to the existing PR on the current branch (do not open a new PR)" |
  "Open a new PR per finding">

## Per-finding pipeline (run for each finding)
1. FIX — spawn a subagent on **Opus** (`model: "opus"`). Give it the finding's full task
   file, tell it to read CLAUDE.md first, implement the fix, tick the task file's
   acceptance checkboxes, set Status to `Done`, and **NOT run any git commands** (leave
   changes in the working tree). It must report the exact diff and every file it touched.
2. BUILD-CHECK + COMMIT — spawn a subagent on **Sonnet** (`model: "sonnet"`). It verifies
   `git status` matches the expected changed-file set (STOP and report if anything extra
   appears), runs `node --check` on each changed JS module plus the project's test suite
   (`node --test js/svg-ingest.test.mjs`), and only if everything passes, stages **exactly**
   that finding's files and makes ONE conventional-commit per finding. If the build check
   fails, it must NOT commit — report the failure verbatim.
3. Do NOT run a review step — I review myself.

## Ordering & parallelism
- One commit per finding, each independently reviewable.
- If two findings touch the same file, process them **sequentially** (a shared working tree
  can't take parallel edits or racing commits). Otherwise sequential is fine and safe.
- Watch for cross-finding dependencies (e.g. an earlier fix adds a normalizer that a later
  fix must extend) and order accordingly — tell me the order and why before starting.

## "Needs review" / unconfirmed findings
- If a finding is marked "Needs review", is unconfirmed, or its fix touches a critical shared
  path and can only be validated at runtime (something `node --check` + unit tests can't
  cover), STOP and ask me how to handle it (verify-first / fix-blind / skip) before touching it.

## Environment constraints (respect these in every agent + your own calls)
- Bash hook forbids chained/compound commands — ONE command per Bash call, no `&&`/`;`,
  use absolute paths (no `cd`).
- Project hard rules (CLAUDE.md): no build step, no backend, no frameworks, vanilla JS/CDN only.
- Commit trailers: end each commit message with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- PR bodies (when opening a PR): end with the "Generated with Claude Code" line.

## Reporting
- After each finding: commit hash + build-check result.
- At the end: a table of all findings (commit, files, pass/fail), plus an explicit list of
  what the automated build-check could NOT cover (runtime/visual behavior) so I know what to
  focus my manual review on. Flag anything an agent changed beyond the finding's stated file
  list.
