// JSON-file backup and restore for pins, groups, and user-uploaded icons.
// The download path mirrors the trigger-download anchor pattern from
// js/export.js, so the file lands in the user's Downloads folder without
// any extra browser prompt. UI preferences (map style, route toggle,
// export text, export format, hide-labels) are intentionally excluded —
// HARDEN-001's "Out of scope" rationale: a backup taken on one machine
// should not stomp the destination's UI choices. API keys are also
// excluded (CLAUDE.md hard rule #3 — keys never travel in JSON exports).
//
// PIL-001 bumps the format from v1 to v2. v2 includes userIcons. v1
// backups are still importable; their userIcons array is implicitly
// empty and the importing device's existing user-icon library is left
// untouched (same treatment as API keys: backups touch only the keys
// they include).

import * as pinStore from "./pins.js";
import * as groupStore from "./groups.js";
import * as userIconStore from "./user-icons.js";
import { showError } from "./storage.js";

const BACKUP_VERSION = 2;
const SUPPORTED_IMPORT_VERSIONS = new Set([1, 2]);

const CONFIRM_MESSAGE_V2 =
  "Replace your current pins, groups, and custom icons with the contents of this file? Existing data will be lost.";

const CONFIRM_MESSAGE_V1 =
  "Replace your current pins and groups with the contents of this file? Existing data will be lost.\n\n(This is a v1 backup — your custom icon library will be left untouched.)";

/**
 * Serialize the current pin / group / user-icon stores to a downloadable
 * JSON file named city-pin-map-YYYY-MM-DD.json. Pretty-printed (2-space)
 * so a user can eyeball the file in any text editor and confirm it
 * survived a sync service or attachment round-trip.
 */
export function exportToJson() {
  try {
    const payload = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      pins: pinStore.listPins(),
      groups: groupStore.listGroups(),
      userIcons: userIconStore.list(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    try {
      triggerDownload(url, `city-pin-map-${todayStamp()}.json`);
    } finally {
      // The browser holds its own reference once the download starts, so
      // freeing the object URL right after click() is safe and avoids a
      // long-lived memory reference for the rest of the page's lifetime.
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error("JSON export failed:", err);
    showError("Could not export JSON. Try again.");
  }
}

/**
 * Read a user-picked .json File, validate it as a v1 or v2 backup,
 * confirm replacement with the user, and apply it through replaceAll()
 * on each store so every existing subscriber updates via pub/sub.
 * Never throws past the user; every failure path lands on the existing
 * error banner via showError.
 */
export async function importFromJson(file) {
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (err) {
    console.error("could not read backup file:", err);
    showError("Could not read that file. Try again.");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("backup file is not valid JSON:", err);
    showError("That file is not valid JSON.");
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    showError("That file is not a City Pin Map backup.");
    return;
  }

  if (!SUPPORTED_IMPORT_VERSIONS.has(parsed.version)) {
    showError(
      typeof parsed.version === "number" && parsed.version > BACKUP_VERSION
        ? "This backup was made with a newer version of the app."
        : "This backup file uses an unsupported format version."
    );
    return;
  }

  if (!Array.isArray(parsed.pins) || !Array.isArray(parsed.groups)) {
    showError("Backup file is missing pins or groups.");
    return;
  }

  const isV2 = parsed.version === 2;
  if (isV2 && !Array.isArray(parsed.userIcons)) {
    showError("Backup file is missing the userIcons field.");
    return;
  }

  const message = isV2 ? CONFIRM_MESSAGE_V2 : CONFIRM_MESSAGE_V1;
  if (!confirm(message)) return;

  // Replace groups before pins. Either order is safe — the existing
  // stale-reference handling in effectiveColor() and the pin-list group
  // selector tolerates a transient mismatch — but loading the referenced
  // entities first reads as the natural order. User icons last for v2;
  // a pin in the imported set whose `icon` references a user-icon id
  // not yet replaced would degrade to default-teardrop until userIcons
  // replaceAll fires, which is acceptable transient state.
  groupStore.replaceAll(parsed.groups);
  pinStore.replaceAll(parsed.pins);
  if (isV2) {
    userIconStore.replaceAll(parsed.userIcons);
  }
  // v1: userIconStore is intentionally untouched. Pins that reference a
  // user icon the local device doesn't have degrade to default-teardrop
  // via effectiveIcon's clamp-to-known-id contract.
}

// Programmatic download via a one-shot anchor. Same pattern as
// js/export.js triggerDownload — the element must be in the DOM for the
// click to take effect in Firefox; appending and removing in the same
// tick is enough.
function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function todayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
