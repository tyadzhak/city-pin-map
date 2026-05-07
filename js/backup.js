// JSON-file backup and restore for pins and groups (HARDEN-001).
// The download path mirrors the trigger-download anchor pattern from
// js/export.js, so the file lands in the user's Downloads folder without
// any extra browser prompt. UI preferences (map style, route toggle,
// export text, export format) are intentionally excluded — see the
// HARDEN-001 task file's "Out of scope" section: a backup taken on one
// machine should not stomp the destination's UI choices.

import * as pinStore from "./pins.js";
import * as groupStore from "./groups.js";
import { showError } from "./storage.js";

// Bumped only when the on-disk shape changes incompatibly. v2+ would
// add a migration branch; anything we don't recognise is rejected with
// a friendly message rather than guessed at.
const BACKUP_VERSION = 1;

const CONFIRM_MESSAGE =
  "Replace your current pins and groups with the contents of this file? Existing data will be lost.";

/**
 * Serialize the current pin and group stores to a downloadable JSON file
 * named city-pin-map-YYYY-MM-DD.json. Pretty-printed (2-space) so a user
 * can eyeball the file in any text editor and confirm it survived a sync
 * service or attachment round-trip.
 */
export function exportToJson() {
  try {
    const payload = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      pins: pinStore.listPins(),
      groups: groupStore.listGroups(),
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
 * Read a user-picked .json File, validate it as a v1 City Pin Map backup,
 * confirm replacement with the user, and apply it through replaceAll() on
 * each store so every existing subscriber (storage, side panel, map, route)
 * updates through the normal pub/sub fan-out. Never throws past the user;
 * every failure path lands on the existing error banner via showError.
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

  // A version we don't know about gets a tailored message: "newer version"
  // when the file is from a future build (forward-compat reminder), generic
  // "unsupported" otherwise. Cheap to do now; saves a confused user later.
  if (parsed.version !== BACKUP_VERSION) {
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

  if (!confirm(CONFIRM_MESSAGE)) return;

  // Replace groups before pins. Either order is safe — the existing
  // stale-reference handling in effectiveColor() and the pin-list group
  // selector tolerates a transient mismatch — but loading the referenced
  // entities first reads as the natural order.
  groupStore.replaceAll(parsed.groups);
  pinStore.replaceAll(parsed.pins);
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
