// PO-004: import pins from a user-supplied CSV or JSON file that is NOT
// the app's own backup shape (that path stays in js/backup.js — see
// looksLikeAppBackup below, which detects it and delegates rather than
// re-implementing it).
//
// Rows that already carry lat/lon become pins immediately. Rows that only
// carry a name are resolved SEQUENTIALLY through the existing geocoder
// (js/geocode.js), which enforces Nominatim's ≥1 req/sec gate and a
// per-tab cache internally — this module never talks to Nominatim itself
// and never bypasses that gate.
//
// "Add" semantics (append to the current pin set) rather than "replace":
// a foreign file is a list of cities the user wants to add, not a full
// snapshot of app state the way a city-pin-map backup is. See PO-004's
// Notes section for the rationale.

import { addPin, DEFAULT_PIN_COLOR } from "./pins.js";
import { searchCities } from "./geocode.js";
import { importFromJson } from "./backup.js";
import { showError } from "./storage.js";

const NAME_KEYS = ["name", "city", "title"];
const LAT_KEYS = ["lat", "latitude"];
const LON_KEYS = ["lon", "longitude", "lng"];
const MAX_FAILED_NAMES_SHOWN = 5;

/**
 * Entry point wired to the "Import from file" button (app.js).
 * Reads `file`, detects its shape, confirms with the user, then applies
 * the resulting rows to the pin store. Every failure path either shows
 * the error banner or lands in the per-row `failed` list surfaced in the
 * completion summary — nothing is silently swallowed.
 *
 * @param {File} file
 */
export async function importFromFile(file) {
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (err) {
    console.error("could not read import file:", err);
    showError("Could not read that file. Try again.");
    return;
  }

  const name = file.name || "";
  let parsed;
  if (/\.json$/i.test(name)) {
    parsed = await parseJsonImport(text, file);
  } else if (/\.csv$/i.test(name)) {
    parsed = parseCsvImport(text);
  } else {
    showError("Unsupported file type. Choose a .csv or .json file.");
    return;
  }

  // null means "already handled" — either delegated to importFromJson or
  // showError was already called. Neither case should fall through here.
  if (parsed === null) return;

  // Parse paths return { rows, skippedBlank }: `rows` are the importable
  // rows, `skippedBlank` counts rows dropped for having no name so the
  // completion summary can report them (parallel to un-geocodable names).
  const { rows, skippedBlank } = parsed;

  if (rows.length === 0) {
    showError("No rows found in that file.");
    return;
  }

  if (!confirm(`Add ${rows.length} new pin${rows.length === 1 ? "" : "s"} to your map?`)) {
    return;
  }

  await applyRows(rows, skippedBlank);
}

// ---- JSON shape detection ----------------------------------------------

async function parseJsonImport(text, file) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("import file is not valid JSON:", err);
    showError("That file is not valid JSON.");
    return null;
  }

  if (looksLikeAppBackup(parsed)) {
    // Delegate entirely — importFromJson owns its own validation, confirm
    // dialog (replace semantics), and error banners. Re-reading file.text()
    // here is safe: File/Blob content can be read more than once.
    await importFromJson(file);
    return null;
  }

  if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
    const trimmed = parsed.map((s) => s.trim());
    const rows = trimmed
      .filter((s) => s.length > 0)
      .map((cityName) => ({ name: cityName, lat: null, lon: null }));
    return { rows, skippedBlank: trimmed.length - rows.length };
  }

  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((item) => item !== null && typeof item === "object" && !Array.isArray(item) && findKeyCI(item, NAME_KEYS) !== undefined)
  ) {
    const mapped = parsed.map(rowFromObject);
    const rows = mapped.filter((row) => row.name.length > 0);
    return { rows, skippedBlank: mapped.length - rows.length };
  }

  showError(
    "Unrecognised JSON shape. Expected an array of cities or a city-pin-map backup file."
  );
  return null;
}

function looksLikeAppBackup(parsed) {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "version" in parsed &&
    ("pins" in parsed || "groups" in parsed)
  );
}

function findKeyCI(obj, candidates) {
  const keys = Object.keys(obj);
  for (const candidate of candidates) {
    const match = keys.find((k) => k.toLowerCase() === candidate);
    if (match !== undefined) return match;
  }
  return undefined;
}

function rowFromObject(obj) {
  const nameKey = findKeyCI(obj, NAME_KEYS);
  const latKey = findKeyCI(obj, LAT_KEYS);
  const lonKey = findKeyCI(obj, LON_KEYS);
  const rowName = nameKey !== undefined ? String(obj[nameKey]).trim() : "";
  const lat = latKey !== undefined ? parseCoord(obj[latKey]) : null;
  const lon = lonKey !== undefined ? parseCoord(obj[lonKey]) : null;
  const hasCoords = hasValidCoords(lat, lon);
  return { name: rowName, lat: hasCoords ? lat : null, lon: hasCoords ? lon : null };
}

// Coerces a raw CSV/JSON coordinate value to a finite number, or null if
// the cell was blank/absent. Number("") and Number(null) both evaluate to
// 0 — without this guard, a blank cell or an explicit JSON `null` silently
// became a (0,0) pin instead of falling through to geocoding as intended.
function parseCoord(raw) {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// Guards against swapped columns / garbage numeric values (e.g. a lon
// value pasted into the lat column) producing an off-map pin with no
// error and no geocode fallback. Out-of-range coordinates are treated as
// "not provided" so the row falls through to the geocode path instead.
function hasValidCoords(lat, lon) {
  return lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// ---- CSV parsing --------------------------------------------------------

// Minimal RFC4180-ish tokenizer: handles quoted fields (with "" as an
// escaped quote), commas embedded inside quotes, and all three line-ending
// variants — \n (Unix), \r\n (Windows), and a bare \r (classic Mac).
// Operating on the whole text (not line-split first) means a quoted field
// can even contain a literal newline correctly.
function tokenizeCsv(text) {
  const table = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      // RFC4180: a quote only opens a quoted field when it is the FIRST
      // character of the field. A `"` mid-field (e.g. `O"Brien City`) is a
      // literal character and falls through to the default append below.
      // `field === ""` is field-start: the buffer is reset on every comma /
      // newline, and an empty quoted field ("") can never be immediately
      // followed by a bare `"` (RFC escaping pairs consecutive quotes), so
      // this never wrongly re-opens after a closing quote.
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" || c === "\n") {
      // Row terminator. All three line-ending variants end a row: \n (Unix),
      // \r\n (Windows), and a bare \r (classic Mac). For \r\n the following
      // \n is consumed here so it can't start a phantom empty row on the next
      // iteration; a lone \r (not followed by \n) terminates on its own.
      // (Inside quotes, \r/\n never reach this branch — they append to the
      // field above, preserving newlines embedded in quoted values.)
      row.push(field);
      table.push(row);
      row = [];
      field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    table.push(row);
  }
  // Drop fully-blank trailing lines (common at end of spreadsheet exports).
  return table.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function parseCsvImport(rawText) {
  // Excel exports a UTF-8 BOM at the top of the file; strip it before the
  // header row is tokenized, otherwise the first column reads as "﻿name".
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const table = tokenizeCsv(text);
  if (table.length === 0) return { rows: [], skippedBlank: 0 };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.findIndex((h) => NAME_KEYS.includes(h));
  const latIdx = header.findIndex((h) => LAT_KEYS.includes(h));
  const lonIdx = header.findIndex((h) => LON_KEYS.includes(h));

  if (nameIdx === -1) {
    showError("CSV needs a 'name' or 'city' column.");
    return null;
  }

  const rows = [];
  let skippedBlank = 0;
  for (const cols of table.slice(1)) {
    const rowName = (cols[nameIdx] ?? "").trim();
    if (!rowName) {
      skippedBlank++;
      continue;
    }
    const lat = latIdx !== -1 ? parseCoord(cols[latIdx]) : null;
    const lon = lonIdx !== -1 ? parseCoord(cols[lonIdx]) : null;
    const hasCoords = hasValidCoords(lat, lon);
    rows.push({ name: rowName, lat: hasCoords ? lat : null, lon: hasCoords ? lon : null });
  }
  return { rows, skippedBlank };
}

// ---- Apply: immediate pins + sequential geocode loop --------------------

async function applyRows(rows, skippedBlank = 0) {
  const immediate = rows.filter((r) => r.lat !== null && r.lon !== null);
  const needsGeocode = rows.filter((r) => r.lat === null || r.lon === null);

  for (const row of immediate) {
    // Capture the origin (FBL-008) from the row's own coordinates so the
    // reset-position affordance restores the imported location.
    addPin({
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      color: DEFAULT_PIN_COLOR,
      group: null,
      originalLat: row.lat,
      originalLon: row.lon,
    });
  }

  const failed = [];
  if (needsGeocode.length > 0) {
    for (const [idx, row] of needsGeocode.entries()) {
      setImportStatus(`Geocoding ${idx + 1}/${needsGeocode.length} — ${row.name}`);
      try {
        const results = await searchCities(row.name);
        const top = results[0];
        if (!top) {
          failed.push({ name: row.name, reason: "no match" });
          continue;
        }
        // Capture the geocoded origin (FBL-008) from the resolved result.
        addPin({
          name: row.name,
          lat: top.lat,
          lon: top.lon,
          color: DEFAULT_PIN_COLOR,
          group: null,
          originalLat: top.lat,
          originalLon: top.lon,
        });
      } catch (err) {
        console.error("geocode failed during import for row:", row.name, err);
        failed.push({ name: row.name, reason: err?.message ?? "geocode error" });
      }
    }
    setImportStatus("");
  }

  const successCount = immediate.length + (needsGeocode.length - failed.length);
  showSummary(successCount, failed, skippedBlank);
}

function setImportStatus(text) {
  const el = document.getElementById("import-file-status");
  if (el) el.textContent = text;
}

function showSummary(successCount, failed, skippedBlank = 0) {
  let message = `Imported ${successCount} pin${successCount === 1 ? "" : "s"}.`;
  if (failed.length > 0) {
    const shownNames = failed.slice(0, MAX_FAILED_NAMES_SHOWN).map((f) => f.name).join(", ");
    const suffix = failed.length > MAX_FAILED_NAMES_SHOWN ? ", …" : "";
    message += ` Could not geocode ${failed.length}: ${shownNames}${suffix}`;
  }
  if (skippedBlank > 0) {
    message += ` Skipped ${skippedBlank} row${skippedBlank === 1 ? "" : "s"} with no name.`;
  }
  alert(message);
}
