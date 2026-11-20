# UXR-006: Pins tab has seven confusing data buttons

| Field           | Value        |
|-----------------|--------------|
| **ID**          | `UXR-006`    |
| **Milestone**   | `UX review`  |
| **Status**      | `Done`       |
| **Severity**    | `High`       |
| **Priority**    | `High`       |

## Summary

The Pins tab put the settings gear, Export JSON, Import JSON, Import from file, Save, Load and New on three rows above the list. They are now one "File" menu plus an autosave note, and the gear moved to the top header.

## Context

**Files:** `index.html` (Pins-tab header, top header), `css/styles.css`, `js/file-menu.js` (new), `js/app.js`, `test/coverage/scenarios/00-boot-and-broad.mjs`

## Failure scenario

The user sees seven unlabelled-by-purpose buttons, "Save" implies work is not auto-saved (it is), "Import JSON" and "Import from file" look like duplicates, and an API-key gear sits among pin actions.

## Fix direction

- Verified `js/import-foreign.js` `parseJsonImport()` delegates backup-shaped JSON (`looksLikeAppBackup`) to `importFromJson()`, so "Import JSON" was redundant and was removed.
- New `js/file-menu.js`: `aria-haspopup="menu"` / `aria-expanded` button, ArrowUp/Down/Home/End, Escape (returns focus), outside-click and item-click close.
- Items keep their old ids (`export-json`, `import-file`, `snapshot-save/load/new`), renamed to "Download backup (.json)", "Import file…" (hint "backup, CSV or city list"), "Save checkpoint", "Restore checkpoint", "New map…".
- Heading shows a live "Pins (N)" count; muted line "Changes are saved automatically in this browser."
- `#open-settings` moved to the right end of the top header.
- `#import-file-status` / `#snapshot-status` inline feedback kept in a row under the note.
- Scenario 00 opens the menu before each snapshot click.

## Acceptance criteria

- [x] List sits directly under one header row: header + note + status row only.
- [x] All former actions reachable from the menu: Playwright smoke exercised every item.
- [x] Autosave note shown.
- [x] Gear in the header: smoke opened Settings from it.
- [x] Scenarios updated: `00-boot-and-broad.mjs`.
