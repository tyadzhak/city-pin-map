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
//
// The 2026-08-11 pin-color-precedence flip bumps v2 → v3. Same fields as
// v2 — the bump exists purely to date the pin.color semantics: in v1/v2 a
// pin always carried a concrete color and an untouched one carried exactly
// DEFAULT_PIN_COLOR, so importing those applies the one-shot
// DEFAULT_PIN_COLOR → null migration (js/storage.js's
// normalizeLoadedPinColor). A v3 payload is post-flip — `null` means
// "inherit" and any concrete color is a deliberate choice — so its colors
// are taken verbatim and an export → import round-trip of a pin the user
// coloured exactly DEFAULT_PIN_COLOR keeps that red. v1 and v2 stay
// importable exactly as before.

import * as pinStore from "./pins.js";
import * as groupStore from "./groups.js";
import * as userIconStore from "./user-icons.js";
import { ingestSvg } from "./svg-ingest.js";
import {
  showError,
  prewriteImportPayloads,
  normalizeLoadedPinColor,
} from "./storage.js";

const BACKUP_VERSION = 3;
const SUPPORTED_IMPORT_VERSIONS = new Set([1, 2, 3]);
// v2 introduced userIcons and v3 kept it — so "has a userIcons array" is a
// >= 2 test, not an === 2 one.
const FIRST_VERSION_WITH_USER_ICONS = 2;
// v3 is the first post-pin-color-precedence-flip format; anything older
// gets the one-shot DEFAULT_PIN_COLOR → null migration on import.
const FIRST_VERSION_WITH_INHERITED_COLORS = 3;

// Fallback for a group whose imported color isn't a 6-digit hex. Matches
// the first shade group-panel.js ships new groups with, so a recovered
// group looks native rather than flagged.
const DEFAULT_GROUP_COLOR = "#e63946";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const CONFIRM_MESSAGE_WITH_ICONS =
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

  // v2 introduced userIcons and v3 keeps it, so this is a >= test — an
  // `=== 2` here would have silently skipped a v3 file's icon library.
  const hasUserIcons = parsed.version >= FIRST_VERSION_WITH_USER_ICONS;
  if (hasUserIcons && !Array.isArray(parsed.userIcons)) {
    showError("Backup file is missing the userIcons field.");
    return;
  }

  const message = hasUserIcons ? CONFIRM_MESSAGE_WITH_ICONS : CONFIRM_MESSAGE_V1;
  if (!confirm(message)) return;

  // Normalize every entry before it reaches a store. A backup file is
  // foreign bytes — hand-edited, truncated by a sync service, or produced
  // by a different app version — so it gets the same defensive treatment
  // as the js/import-foreign.js (PO-004) path rather than being trusted
  // verbatim. Invalid entries are dropped (never coerced into a broken
  // pin or an unsanitized icon) and counted so the drop is surfaced, not
  // silently swallowed (CLAUDE.md error-handling convention).
  const dropped = { pins: 0, groups: 0, userIcons: 0 };
  const groups = normalizeGroups(parsed.groups, dropped);
  // v1/v2 predate the pin-color-precedence flip, so their pins get the
  // one-shot DEFAULT_PIN_COLOR → null migration; v3's colors are verbatim.
  const pins = normalizePins(parsed.pins, dropped, {
    migrateLegacyDefault: parsed.version < FIRST_VERSION_WITH_INHERITED_COLORS,
  });
  const userIcons = hasUserIcons ? normalizeUserIcons(parsed.userIcons, dropped) : null;

  // FBL-016: persist the whole import as a unit BEFORE mutating any store.
  // The three replaceAll cascades below each fire their own save subscriber;
  // if a later one (saveUserIcons — the largest payload) hit quota it would
  // swallow the failure with only a transient banner, leaving groups + pins
  // persisted but user icons gone — a torn on-disk state that looks fully
  // imported in memory yet loses part of itself on reload. Pre-writing all
  // three keys up front (with rollback on any failure) turns that silent
  // partial loss into a clean, fully-aborted import. v1 imports pass
  // userIcons: null so the local library is left untouched, mirroring the
  // hasUserIcons gate on the replaceAll below.
  const persisted = prewriteImportPayloads({
    pins,
    groups,
    userIcons: hasUserIcons ? userIcons : null,
  });
  if (!persisted) {
    showError(
      "Import was NOT applied: this backup does not fit in your browser's storage. Your existing pins, groups, and custom icons are unchanged — free up space and try again."
    );
    return;
  }

  // Replace groups before pins. Either order is safe — the existing
  // stale-reference handling in effectiveColor() and the pin-list group
  // selector tolerates a transient mismatch — but loading the referenced
  // entities first reads as the natural order. User icons last for v2/v3;
  // a pin in the imported set whose `icon` references a user-icon id
  // not yet replaced would degrade to default-teardrop until userIcons
  // replaceAll fires, which is acceptable transient state.
  groupStore.replaceAll(groups);
  pinStore.replaceAll(pins);
  if (hasUserIcons) {
    userIconStore.replaceAll(userIcons);
  }
  // v1: userIconStore is intentionally untouched. Pins that reference a
  // user icon the local device doesn't have degrade to default-teardrop
  // via effectiveIcon's clamp-to-known-id contract.

  reportDropped(dropped);
}

// Assemble one user-visible summary of anything the normalizers rejected.
// A clean import (the common case, incl. every valid v1/v2 round-trip)
// shows nothing — only actual drops surface.
function reportDropped(dropped) {
  const parts = [];
  if (dropped.pins > 0) parts.push(pluralize(dropped.pins, "pin"));
  if (dropped.groups > 0) parts.push(pluralize(dropped.groups, "group"));
  if (dropped.userIcons > 0) parts.push(pluralize(dropped.userIcons, "custom icon"));
  if (parts.length === 0) return;
  showError(
    `Import finished, but skipped ${parts.join(", ")} that couldn't be read. Everything else was imported.`
  );
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// ── Pure normalizers ────────────────────────────────────────────────────
//
// Each takes the raw array and a mutable `dropped` counter, returns a
// clean array, and never throws. They are intentionally permissive for
// already-valid data (a healthy Export JSON → Import JSON round-trips
// unchanged) and strict only where a bad value would corrupt a store:
// out-of-range coordinates, empty names, or un-sanitizable icon markup.

function normalizePins(rawPins, dropped, { migrateLegacyDefault = false } = {}) {
  const out = [];
  for (const raw of rawPins) {
    if (!raw || typeof raw !== "object") {
      dropped.pins++;
      continue;
    }
    const lat = toFiniteNumber(raw.lat);
    const lon = toFiniteNumber(raw.lon);
    const hasName = typeof raw.name === "string" && raw.name.trim().length > 0;
    if (
      lat === null || lat < -90 || lat > 90 ||
      lon === null || lon < -180 || lon > 180 ||
      !hasName
    ) {
      dropped.pins++;
      continue;
    }
    const pin = {
      id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
      name: raw.name,
      lat,
      lon,
      // Same normalizer as the boot-time loader (storage.js's
      // normalizeLoadedPins) — see normalizeLoadedPinColor's doc comment
      // there. A missing/blank color always becomes null (inherit); the
      // DEFAULT_PIN_COLOR → null heuristic applies ONLY to a pre-flip
      // (v1/v2) payload, per migrateLegacyDefault above, so a v3 file's
      // colors — including a deliberately-picked DEFAULT_PIN_COLOR —
      // round-trip verbatim.
      color: normalizeLoadedPinColor(raw.color, { migrateLegacyDefault }),
      group: typeof raw.group === "string" ? raw.group : null,
      icon: typeof raw.icon === "string" ? raw.icon : null,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    };
    // Carry the geocoded origin through import (FBL-008) so Export → Import
    // round-trips the "reset position" affordance. Only when BOTH are finite
    // and in range — never regenerate or invent an origin; a pin that lacks
    // them stays button-less on the destination (pre-FBL-008 contract).
    const originalLat = toFiniteNumber(raw.originalLat);
    const originalLon = toFiniteNumber(raw.originalLon);
    if (
      originalLat !== null && originalLat >= -90 && originalLat <= 90 &&
      originalLon !== null && originalLon >= -180 && originalLon <= 180
    ) {
      pin.originalLat = originalLat;
      pin.originalLon = originalLon;
    }
    // labelDx/labelDy (per-pin label drag offset, screen px): optional,
    // like originalLat/originalLon — only carried over when finite, else
    // omitted so a consumer's `pin.labelDx ?? 0` fallback applies. Mirrors
    // js/storage.js normalizeLoadedPins exactly so Export JSON → Import
    // JSON round-trips a dragged label offset instead of silently
    // resetting it to the pin's default position.
    const labelDx = toFiniteNumber(raw.labelDx);
    if (labelDx !== null) pin.labelDx = labelDx;
    const labelDy = toFiniteNumber(raw.labelDy);
    if (labelDy !== null) pin.labelDy = labelDy;
    out.push(pin);
  }
  return out;
}

function normalizeGroups(rawGroups, dropped) {
  const out = [];
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== "object") {
      dropped.groups++;
      continue;
    }
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      dropped.groups++;
      continue;
    }
    out.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
      name: raw.name,
      color: typeof raw.color === "string" && HEX_COLOR_RE.test(raw.color)
        ? raw.color
        : DEFAULT_GROUP_COLOR,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    });
  }
  return out;
}

function normalizeUserIcons(rawIcons, dropped) {
  const out = [];
  for (const raw of rawIcons) {
    if (!raw || typeof raw !== "object") {
      dropped.userIcons++;
      continue;
    }
    // The sanitizer's contract is "everything in the user-icon store is
    // allowlist-clean." A backup's fillSvg has never been through it, so
    // run it here: on any rejection or throw, drop the entry rather than
    // persist markup the icon-picker upload path would have refused.
    let result;
    try {
      result = ingestSvg(raw.fillSvg);
    } catch (err) {
      console.error("user icon failed to ingest during import:", err);
      dropped.userIcons++;
      continue;
    }
    if (!result || !result.ok) {
      dropped.userIcons++;
      continue;
    }
    out.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
      name: typeof raw.name === "string" ? raw.name : "",
      tintable: Boolean(raw.tintable),
      fillSvg: result.sanitizedSvg,
      attribution: normalizeAttribution(raw.attribution),
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    });
  }
  return out;
}

function normalizeAttribution(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    artistName: typeof raw.artistName === "string" ? raw.artistName : null,
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : null,
  };
}

// Coerce a raw coordinate to a finite number, or null when blank/absent/
// unparseable. Mirrors js/import-foreign.js parseCoord — Number("") and
// Number(null) both yield 0, which without this guard would smuggle a
// (0,0) pin past the range check.
function toFiniteNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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
