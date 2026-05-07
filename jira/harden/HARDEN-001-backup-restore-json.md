# HARDEN-001: Backup and restore as JSON

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-001`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `None`                                      |

## Summary

Add **Export JSON** and **Import JSON** buttons that download / upload a single file containing every pin and every group. A user whose browser data is cleared (or who switches machines) can recover their full state from the file. This is the only path between hours of pinning and silent data loss — currently there is none.

## Context

Persistence today is `localStorage` only. `js/storage.js` writes six keys (`city-pin-map.pins.v1`, `city-pin-map.groups.v1`, `city-pin-map.map-style.v1`, `city-pin-map.route-visible.v1`, `city-pin-map.export-text.v1`, `city-pin-map.export-format.v1`). The first two hold the user-created data the user actually cares about; the other four are UI preferences and can be regenerated trivially. The backup file should therefore contain only `pins` and `groups` — preferences are intentionally out of scope so a backup from a different machine doesn't override the destination's UI choices.

The pin and group entity shapes are documented in `CLAUDE.md` → "Pin data model". Both stores expose `replaceAll()` (see `js/pins.js`, `js/groups.js`), which is the right entry point for restoring state because it triggers the same `notify()` fan-out the rest of the app already uses for hydration.

`README.md` already warns the user that "clearing your browser data wipes the pins. There is currently no built-in backup — that's planned for the next milestone." This task closes that loop; remove the warning from the README as part of the change.

## Acceptance criteria

- [ ] A new button **Export JSON** is visible in the side panel (next to or above the Pins heading is fine).
- [ ] Clicking **Export JSON** downloads a file named `city-pin-map-{YYYY-MM-DD}.json` whose contents are a JSON object with the shape:

  ```json
  {
    "version": 1,
    "exportedAt": "2026-05-08T12:34:56.000Z",
    "pins": [ /* full pin objects in their stored shape */ ],
    "groups": [ /* full group objects in their stored shape */ ]
  }
  ```

- [ ] A new button **Import JSON** is visible adjacent to **Export JSON** and opens a file picker restricted to `.json`.
- [ ] On a valid file, a `confirm()` dialog warns "Replace your current pins and groups with the contents of this file? Existing data will be lost." Cancelling leaves state untouched.
- [ ] On confirm, both stores are replaced via `replaceAll()` so the map, side panel, route, and storage subscribers all update through the existing pub/sub fan-out.
- [ ] Invalid JSON, wrong top-level shape, or missing `pins` / `groups` arrays shows a friendly message via the existing error banner (`showError` in `storage.js`) and does not change any state.
- [ ] A pin whose `group` references a group not present in the imported `groups` array is allowed in (the existing stale-reference handling in `effectiveColor` and `pin-list.js` covers it).
- [ ] An export → import round-trip on the same machine produces a byte-identical pin set and group set (modulo `createdAt` ordering, which is preserved).
- [ ] Both buttons are keyboard-accessible (focusable, Enter/Space activate).
- [ ] The README warning about no built-in backup is removed.
- [ ] No regressions in previously completed tasks.
- [ ] No errors in browser console.

## Files affected

```
+ js/backup.js
~ js/app.js
~ index.html
~ css/styles.css
~ README.md
```

(If `js/backup.js` would be tiny — under ~40 lines — fold it into `js/storage.js` instead. Reuse beats new files.)

## Out of scope

- Backing up UI preferences (map style, route toggle, export text, export format). The user keeps their UI state; backups are about data.
- Merging an imported set with the existing set. Replacement only — merge semantics ("keep both", "deduplicate by name") get rabbit-holey fast and are not needed for the headline use case (recover from data loss, move to a new machine).
- Cloud sync, sharing, or any kind of server upload. Out of scope per `PROJECT.md` → "Out of scope".
- Versioned migration logic. The `version` field is included so future imports can branch, but only `version: 1` is handled in this task; other versions are rejected with a friendly error.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read this task file in full.

Task: Add JSON-file backup and restore for pins and groups.

Requirements:
- Add an Export JSON button in the side panel that downloads a file
  city-pin-map-YYYY-MM-DD.json with shape { version: 1, exportedAt, pins, groups }.
- Add an Import JSON button that opens a .json file picker, parses the file,
  validates the shape, asks the user to confirm replacement, then calls
  pinStore.replaceAll() and groupStore.replaceAll() to apply it.
- Show a friendly error via showError() on invalid file / wrong shape /
  unsupported version. Never throw past the user.
- Round-trip on the same machine must preserve pin and group data exactly.
- Remove the README warning "There is currently no built-in backup — that's
  planned for the next milestone." Replace with a sentence pointing to
  Export JSON / Import JSON.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- Reuse existing primitives: replaceAll() on each store, showError() for
  banner messages, the trigger-download anchor pattern from js/export.js
  (todayStamp + programmatic <a download>).
- Backup format intentionally excludes UI preferences — see this task's
  "Out of scope" section.

Deliverables:
- js/backup.js (or additions to js/storage.js if smaller than ~40 lines)
  exporting exportToJson() and importFromJson(File).
- index.html — two buttons in the <aside class="app-side"> wrapper, near the
  Pins heading.
- js/app.js — wire the two buttons in initBackupControls() called from init().
- css/styles.css — minimal styling matching the existing side-panel buttons.
- README.md — replace the "no built-in backup" sentence with the new behavior.

Verification:
- Pin a few cities, create a group, assign a pin to the group. Click Export JSON;
  inspect the downloaded file and confirm the shape. Open the app in a fresh
  Incognito window so localStorage is empty. Click Import JSON, pick the file,
  confirm — every pin and group reappears with correct positions, names, and
  colors.
- Try importing an invalid file (e.g. a .txt renamed to .json, or a JSON object
  missing the pins array). Confirm a banner appears and no state changes.
- All acceptance criteria in this task file are satisfied.

When finished:
- Update this task file's Status field to `Done` and tick every acceptance
  criteria checkbox.
- Create a feature branch `harden-001-backup-restore-json`.
- Commit with message `HARDEN-001: backup and restore via JSON file` and the
  Co-Authored-By footer matching this repo's commit style.
- Push the branch and open a pull request titled
  `HARDEN-001: backup and restore via JSON file` against `main`.
```

## Notes

- The `version` field is forward-looking: a future `version: 2` (e.g. when an extra pin field is added) can run a migration, while a version greater than what the importer supports is rejected with "This backup was made with a newer version of the app." Cheap to bake in now.
- Resist the urge to add per-pin selective import. The simple-replacement semantics make the feature obviously correct; once you start letting users cherry-pick rows, edge cases multiply.
