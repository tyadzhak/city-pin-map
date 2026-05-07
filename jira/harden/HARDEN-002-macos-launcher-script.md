# HARDEN-002: macOS double-clickable launcher

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-002`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `None`                                      |

## Summary

Add a `start.command` shell script in the project root that a non-technical macOS user can double-click to launch the app: it starts `python3 -m http.server` from the project folder and opens the default browser at the local URL. Closing the Terminal window stops the server. This converts the hand-off problem from "open Terminal, type three commands" into a single double-click.

## Context

`README.md` currently asks the non-technical user to open Terminal, `cd` into the folder, run `python3 -m http.server 8000`, and visit `http://localhost:8000`. That's four steps and three concepts (`cd`, `python3`, `localhost`) the user doesn't have. The launcher script collapses all four into one double-click.

`PROJECT.md` → "Out of scope" already excludes server-side anything. This task adds **launch tooling**, not a runtime — the script is a thin wrapper around the same `python3 -m http.server` the README documents.

The single-OS scope is deliberate: the actual non-technical user is on macOS. Building a Windows `.bat` equivalent at the same time would double the testing surface for a user who will never run it.

`CLAUDE.md` → "Hard rules" #5 ("must run by opening `index.html` directly or with a trivial static server") is preserved: the script does the trivial-static-server step, nothing more. No build step is added.

## Acceptance criteria

- [ ] `start.command` exists in the project root and is marked executable (`chmod +x`).
- [ ] Double-clicking the file in Finder opens a Terminal window AND, after a brief delay, opens the default browser at `http://localhost:8000` showing the app.
- [ ] The script `cd`s to its own directory before starting the server, so the user can move the project folder anywhere on disk and the script still works.
- [ ] If port 8000 is already in use, the script tries the next available port up to 8010 and uses the first one that binds; the browser is opened at the actual port chosen.
- [ ] If `python3` is not on `PATH`, the Terminal window prints a clear, plain-English message: "Python 3 isn't installed. Install it from python.org and try again." and waits for the user to press a key before exiting.
- [ ] Closing the Terminal window stops the server (no orphaned `python3` process).
- [ ] The script is plain `bash`/`sh` — no extra binaries, no homebrew, no Node, no dependencies a vanilla macOS doesn't already have.
- [ ] `README.md` is updated: the "How to run it (non-technical version)" macOS section now says "Double-click `start.command`. The first time, macOS may ask if you're sure — click Open." instead of the four-step Terminal walkthrough. The developer-version section keeps the manual command for reference.
- [ ] No regressions in previously completed tasks.

## Files affected

```
+ start.command
~ README.md
```

## Out of scope

- Windows `start.bat`. Rejected for this milestone — the actual user is on macOS, and a multi-OS launcher doubles the testing surface.
- Code-signing the script. Unsigned `.command` files trigger a one-time Gatekeeper "Are you sure?" prompt. Document the prompt in the README; do not pursue an Apple Developer ID for a personal app.
- Any kind of installer / `.dmg` / `.app` bundle. The double-clickable file is the install.
- Auto-update. The user runs `git pull` (or re-downloads the folder) when they want a new version.
- Hiding the Terminal window. The window is the user's "stop button" — closing it is how the server shuts down. Hiding it would orphan the process.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read this task file in full.

Task: Add a macOS double-clickable launcher (start.command) that starts a static server and opens the browser at the app URL.

Requirements:
- start.command must:
  1. cd to its own directory (use `cd "$(dirname "$0")"`).
  2. Verify python3 is on PATH; if not, print a friendly message and pause.
  3. Pick the first free port from 8000–8010.
  4. Open the user's default browser at http://localhost:PORT (use `open`).
  5. Run `python3 -m http.server PORT` so the script blocks until the user
     closes the Terminal window. Closing the window terminates the server.
- The script must work no matter where the user has placed the project folder.
- Keep the script under ~30 lines including comments. Pure bash.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- No external dependencies beyond what ships with macOS (bash, python3, lsof, open).
- Do not introduce any other tooling files. One script, one README edit.

Deliverables:
- start.command (chmod +x, committed with the executable bit).
- README.md — replace the four-step Terminal walkthrough in the macOS section
  with the double-click flow. Mention the Gatekeeper prompt on first run.

Verification:
- Run `chmod +x start.command && open start.command` from a Terminal — confirm
  a Terminal window appears, the browser opens, the app loads.
- Manually start `python3 -m http.server 8000` in another shell, then
  double-click start.command — confirm the script falls through to 8001 and
  opens the browser there.
- Rename `python3` temporarily on PATH (or run on a machine without it) and
  confirm the friendly error message appears and the window stays open until
  a key is pressed.
- Close the Terminal window — confirm `ps aux | grep http.server` shows no
  leftover process.
- All acceptance criteria in this task file are satisfied.

When finished:
- Update this task file's Status field to `Done` and tick every acceptance
  criteria checkbox.
- Create a feature branch `harden-002-macos-launcher-script`.
- Commit with message `HARDEN-002: macOS start.command launcher` and the
  Co-Authored-By footer matching this repo's commit style. Make sure the
  executable bit on start.command is preserved in the commit.
- Push the branch and open a pull request titled
  `HARDEN-002: macOS start.command launcher` against `main`.
```

## Notes

- Test the script on the actual machine the non-technical user will be using if at all possible. macOS versions vary on default `python3` availability — recent macOS ships it; very old ones don't.
- A first-run Gatekeeper prompt is expected and is not a bug. Document it in the README so the user isn't startled.
