# PO-004: Import pins from a CSV or JSON file

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-004`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `L`                                         |
| **Depends on**  | `HARDEN-001`                                |

## Summary

Add an "Import from file" button that ingests user-supplied CSV or JSON files containing a city list — with or without coordinates — and turns each row into a pin. Rows that have only a name (no `lat`/`lon`) are geocoded via the existing Nominatim wrapper. The result lets a user with a Google Sheets / Notion / Excel travel list bring it into the app in one shot, instead of typing each city into the search box.

## Context

`js/backup.js` (HARDEN-001) already implements Export/Import JSON for the app's own backup format `{ version, exportedAt, pins, groups }`. That file is well-formed and round-trips losslessly. What it does NOT support is third-party shapes — a CSV with three columns from a spreadsheet, a JSON array of `{name, lat, lon}` from a public dataset, or a plain list of city names with no coordinates.

This task extends the import path to accept those shapes. Format detection runs against the file:

- **CSV** — header row required. Recognised columns (case-insensitive): `name` (or `city`, or `title`), `lat` (or `latitude`), `lon` (or `longitude`, `lng`). At minimum a name-bearing column is needed.
- **JSON** — either the existing app backup shape (delegate to HARDEN-001's importer) OR a top-level array of objects with `name`/`lat`/`lon` fields, OR a top-level array of strings (city names only).

For rows that arrive without coordinates, the existing geocoder in `js/geocode.js` is invoked. That wrapper already enforces ≥1 req/sec rate-limiting and per-tab caching. A bulk import of 50 city-name-only rows therefore takes ~50 seconds; the user sees a progress indicator and a per-row status ("Geocoded Tokyo (12/50)"). Failures (no result, ambiguous result chosen automatically as the top hit, network error) are logged and surfaced in a final summary dialog rather than silently swallowed.

The existing pin/group data model is the destination: each imported row becomes a pin with `id: crypto.randomUUID()`, `color: <default>`, `group: null`, `createdAt: Date.now()`. Group assignment is out of scope (the user can group imported pins manually after).

## Acceptance criteria

- [ ] A new "Import from file" button is visible in the side panel near the existing Export JSON / Import JSON buttons.
- [ ] Clicking it opens a file picker accepting `.csv` and `.json`.
- [ ] CSV with `name,lat,lon` (or recognised column-name variants) imports cleanly — every row becomes a pin at the correct coordinate.
- [ ] CSV with only a name column (e.g. `city` only) triggers geocoding for each row, respecting Nominatim's 1 req/sec policy.
- [ ] JSON array of `{name, lat, lon}` imports cleanly.
- [ ] JSON array of strings (e.g. `["Kyiv", "Lviv", "Odesa"]`) triggers geocoding per name.
- [ ] JSON in the app's own backup format is detected and routed to HARDEN-001's importer (replacement, with confirm dialog) — do NOT duplicate that path; reuse it.
- [ ] On entering an unknown shape (CSV with no recognisable columns, JSON neither array nor app-backup format, malformed file), a friendly error banner appears and no state changes.
- [ ] Before applying, a confirmation dialog asks "Add 50 new pins to your map?" (or similar) with options Add or Cancel. Cancel is non-destructive.
- [ ] During geocoding, a non-blocking progress indicator shows "Geocoding 12/50 — Tokyo…". The user can keep using the rest of the UI.
- [ ] On completion, a summary toast/dialog shows "Imported 47 pins. 3 rows failed (skipped): {names}".
- [ ] Imported pins receive default color and `group: null`; user can edit afterwards.
- [ ] Imported pins persist via the existing pin store + localStorage path.
- [ ] No regressions in previously completed tasks (especially HARDEN-001's app-backup import path).
- [ ] No errors in browser console.

## Files affected

```
~ js/backup.js
~ js/app.js
~ index.html
~ css/styles.css
```

(If the import logic in `js/backup.js` exceeds ~250 lines after this change, split a `js/import-foreign.js` for the CSV/foreign-JSON parsers and keep `backup.js` focused on the app's own format.)

## Out of scope

- **GPX, KML, GeoJSON file types.** GeoJSON specifically is tempting but pulls in feature/geometry shape decisions that aren't needed for the headline ask (a list of cities). Defer to a follow-up task if a user asks.
- **Auto-deduplication** with existing pins by name or coordinate. The user can edit afterwards. Auto-dedup multiplies edge cases (case-sensitivity, near-coordinate match thresholds, group-membership conflicts).
- **Group import / per-row group assignment.** Importing groups would require a sister CSV / nested JSON shape. Out of scope; user can re-group after.
- **Async cancel of an in-progress geocode batch.** Useful but adds state-machine complexity; a 50-row import takes a minute, the user can wait or close the tab.
- **Custom column mapping UI** ("which column is the city name?"). Auto-detect via the case-insensitive recognised-name list keeps the UX one-click.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read js/backup.js (HARDEN-001's import/export), js/geocode.js (rate limit + cache), and js/pins.js (the store's add/replaceAll API).

Task: Add an "Import from file" path that accepts CSV and foreign-shape JSON, geocoding rows that lack coordinates, and adds the resulting pins to the existing store.

Requirements:

UI (index.html, css/styles.css):
- Add a button "Import from file" in the side panel next to the existing Export JSON / Import JSON buttons. Same visual treatment.
- Add a small inline progress element next to the button for use during geocoding (hidden by default).

js/backup.js (or split to js/import-foreign.js if size warrants):
- Export importFromFile(file: File). The flow:
  1. Inspect file.name extension and file content.
  2. If extension is .json:
     a. JSON.parse the content. If it's the app backup shape ({ version, pins, groups }), delegate to HARDEN-001's existing importFromJson(file) path (confirm dialog, replaceAll on both stores).
     b. If it's a top-level array of objects with name+lat+lon (loose), turn each row into a pin and add to the store.
     c. If it's a top-level array of strings, treat each entry as a city name to geocode.
     d. Otherwise: showError("Unrecognised JSON shape. Expected an array of cities or a city-pin-map backup file.") and return.
  3. If extension is .csv:
     a. Parse with a small inline CSV parser (~30 lines). Handle quoted strings, embedded commas inside quotes, and \r\n / \n line endings.
     b. Detect columns case-insensitively from the header row. Accept name|city|title for the name column, lat|latitude for lat, lon|lng|longitude for lon.
     c. If a name column is missing: showError("CSV needs a 'name' or 'city' column.") and return.
     d. If lat+lon columns are present, take coordinates directly; otherwise queue for geocoding.
  4. Compute the count of new pins. Show a confirm dialog: "Add N new pins to your map?". Cancel returns without state changes.
  5. For rows with coordinates: build pin objects { id: crypto.randomUUID(), name, lat, lon, color: DEFAULT_PIN_COLOR (existing constant), group: null, createdAt: Date.now() } and call pinStore.add() per pin (or pinStore.replaceAll([...current, ...new]) for one notify — pick whichever is consistent with the existing addPin path).
  6. For rows that need geocoding: iterate sequentially through the existing geocoder (which gates ≥1 req/sec internally — do NOT bypass it). Per row:
     - Update progress UI: "Geocoding K/N — {name}".
     - Take the top result if any; on no result, push the row to a `failed` list with reason "no match".
     - On result, build the pin and add to the store.
     - On exception, push to `failed` with the error message.
  7. On completion of the geocode loop, show a summary dialog: "Imported {success} pins." plus, if failed.length > 0, "Could not geocode {failed.length}: {names joined by comma, truncate at 5 with '…'}"
- Reuse the existing showError() helper from storage.js for any banner-level errors.

js/app.js:
- Wire the new button to call importFromFile(picked file) inside an initImportControls() function called from init(), mirroring HARDEN-001's wiring pattern.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- Do NOT introduce a dependency for CSV parsing (no PapaParse, no csv-parse). Inline ~30 lines of CSV parsing — quoted-string handling and \r\n is enough.
- Do NOT bypass the geocoder's rate limit. The whole point of using the existing wrapper is correctness with Nominatim's policy.
- Do NOT silently swallow errors — every failure path either updates state via showError() or is captured in the per-row `failed` list and surfaced in the final summary.
- Keep the app's own backup format path (HARDEN-001) unchanged — this task only ADDS new shapes.

Deliverables:
- Updated js/backup.js (or new js/import-foreign.js if split).
- Updated index.html with the button and progress element.
- Updated css/styles.css with styling consistent with existing side-panel buttons.
- Updated js/app.js wiring the click.

Verification:
- Create a test CSV: `name,lat,lon\nKyiv,50.4501,30.5234\nLviv,49.8397,24.0297`. Import. Two pins appear at correct coordinates immediately (no geocoding).
- Create a test CSV with only a city column: `city\nTokyo\nKyoto\nOsaka`. Import. Confirm dialog appears. Confirm. Progress indicator shows "Geocoding 1/3 — Tokyo" then 2/3, 3/3, taking ~3 seconds total. Three pins appear at the geocoded coordinates.
- Import a JSON array `["Vienna","Prague","Budapest"]`. Same geocoding flow.
- Import a JSON array `[{"name":"Berlin","lat":52.52,"lon":13.405}]`. One pin appears immediately.
- Import a corrupted file (a .txt renamed .csv with no recognisable columns). Friendly error banner. No state change.
- Import a city-pin-map backup file (the HARDEN-001 export). The replace-confirm dialog from HARDEN-001 appears, not the add dialog from this task.
- Import a CSV with one nonexistent city ("Atlantis"). Other rows succeed; final summary names Atlantis as failed.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- **Add vs Replace semantics.** This task chose "add" (new pins are appended to the existing set) for foreign-format imports because the use case is "I have a list of cities I want to add to my map". HARDEN-001's app-backup import keeps "replace" because that file is a complete snapshot, not a list. Different semantics for different shapes is the right call here — the file shape itself signals user intent.
- **Default color.** New pins use the same default the manual add-via-search path uses (DEFAULT_PIN_COLOR in pins.js). Don't introduce a per-import-batch random color or a new "imported" group — the user can re-group after import.
- **Geocoder cache benefit.** The same wrapper that handles search input is reused, so a second import of the same city list resolves instantly from the per-tab cache. This is a small but real ergonomic win during testing.
- **CSV quirk to expect.** Excel exports CSVs with a UTF-8 BOM (`﻿`) at the top of the file. Strip it from the first line before column detection; otherwise the first column becomes "﻿name" and the case-insensitive matcher fails.
