# UXR-015 — Success feedback for export/restore and title-based file name

- **ID:** UXR-015
- **Milestone:** UX review
- **Status:** Done
- **Severity:** Medium
- **Priority:** Medium

## Summary
PNG export and backup restore finished silently, and every PNG was named `city-pin-map-YYYY-MM-DD.png` regardless of the map's title.

## Context
- `js/export.js` (`exportMapAsPng`, `triggerDownload` area)
- `js/export-quality.js` (new pure `slugify`, `buildExportFilename`)
- `js/app.js` (`initExportButton`)
- `js/backup.js` (`importFromJson`)
- `js/export-filename.test.mjs`

## Failure scenario
The user clicks Export PNG and sees the progress label vanish with no confirmation; a restored backup gives no "done" signal; several exports pile up with indistinguishable names.

## Fix direction
- `exportMapAsPng` now returns the file name on success and `null` on failure (its internal catch still shows the error), so `initExportButton` shows a "Saved <filename>" success toast only on a real success.
- The file name is the slug of the first non-empty on-map title line (lowercase ASCII, hyphens, max 40 chars) plus `-YYYY-MM-DD.png`, falling back to `city-pin-map-YYYY-MM-DD.png`. The helper is pure and lives in `export-quality.js`.
- `importFromJson` fires one "Restored N pins and M groups" success toast at the end. `import-foreign.js` only delegates backup-shaped files there and shows nothing of its own for them, so it fires exactly once and never doubles with the CSV summary toast.

## Acceptance criteria
- [x] Success feedback for export and restore (toasts; failures keep error paths).
- [x] Title-based filename with fallback (`buildExportFilename`).
- [x] Helper tests (`js/export-filename.test.mjs`, 5 cases pass).
