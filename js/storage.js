// DEFAULT_PIN_COLOR is the single source of truth for a new pin's shade
// (pins.js). Imported here so the boot-time pin normalizer (FBL-014) can
// repair a saved pin with a missing/blank color to the same default the
// backup-import path uses. pins.js imports nothing, so this is cycle-free.
import { DEFAULT_PIN_COLOR } from "./pins.js";

const STORAGE_KEY = "city-pin-map.pins.v1";
const GROUPS_STORAGE_KEY = "city-pin-map.groups.v1";
const MAP_STYLE_KEY = "city-pin-map.map-style.v1";
const ROUTE_VISIBLE_KEY = "city-pin-map.route-visible.v1";
const EXPORT_FORMAT_KEY = "city-pin-map.export-format.v1";
const EXPORT_FRAME_KEY = "city-pin-map.export-frame.v1";
const HIDE_LABELS_KEY = "city-pin-map.hide-labels.v1";
// PO-008/009 — single on-map title with formatting. PO-009 retired the
// separate NICE-006 title strip (city-pin-map.export-text.v1); existing
// users see their title/subtitle wiped on first load with this build.
// Acceptable trade-off for a personal app — see CLAUDE.md "no backwards-
// compatibility shims when you can just change the code".
const ON_MAP_TITLE_KEY = "city-pin-map.export-on-map-title.v1";

// User-uploaded icon library (PIL-001). Same defensive load shape as
// loadPins/loadGroups: missing key → empty, corrupt → empty + banner.
const USER_ICONS_KEY = "city-pin-map.user-icons.v1";

// API keys for free-tier basemap providers (Stadia / MapTiler / Thunderforest).
// Stored as bare strings — same convention as MAP_STYLE_KEY. Never inlined in
// source; never included in JSON backup exports (see backup.js scope).
const STADIA_API_KEY = "city-pin-map.stadia-key.v1";
const MAPTILER_API_KEY = "city-pin-map.maptiler-key.v1";
const THUNDERFOREST_API_KEY = "city-pin-map.thunderforest-key.v1";

const API_KEY_STORAGE_BY_PROVIDER = {
  stadia: STADIA_API_KEY,
  maptiler: MAPTILER_API_KEY,
  thunderforest: THUNDERFOREST_API_KEY,
};

const DEFAULT_EXPORT_FORMAT = "current";
const BANNER_TIMEOUT_MS = 6000;

// Fallback color for a saved group whose stored color isn't a 6-digit hex.
// Mirrors backup.js's DEFAULT_GROUP_COLOR (the first shade group-panel.js
// ships new groups with) so a repaired group looks native rather than flagged.
const DEFAULT_GROUP_COLOR = "#e63946";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// PO-008/009 — on-map title state. lon/lat are nullable so the input can
// hold text before a position has been chosen; the live overlay seeds
// them from the map's current center on first reveal.
//
// Formatting fields (font/bold/italic/color/size) come from PO-009. The
// curated font list is kept here so storage validation can clamp an
// unknown saved string to the default. Adding a font: append a fontstack
// to ON_MAP_TITLE_FONTS, an <option> to index.html's #otm-font select.
export const ON_MAP_TITLE_FONTS = Object.freeze([
  'Georgia, "Times New Roman", serif',
  '"Times New Roman", Times, serif',
  "Helvetica, Arial, sans-serif",
  "Verdana, Geneva, sans-serif",
  '"Trebuchet MS", "Lucida Sans Unicode", sans-serif',
  '"Courier New", Courier, monospace',
  'Impact, "Arial Black", sans-serif',
]);
const DEFAULT_ON_MAP_TITLE_FONT = ON_MAP_TITLE_FONTS[0];
const ON_MAP_TITLE_SIZE_MIN = 10;
const ON_MAP_TITLE_SIZE_MAX = 80;
const DEFAULT_ON_MAP_TITLE_SIZE = 20;
const DEFAULT_ON_MAP_TITLE_COLOR = "#1f2937";
const EMPTY_ON_MAP_TITLE = Object.freeze({
  text: "",
  lon: null,
  lat: null,
  font: DEFAULT_ON_MAP_TITLE_FONT,
  bold: true,
  italic: false,
  color: DEFAULT_ON_MAP_TITLE_COLOR,
  size: DEFAULT_ON_MAP_TITLE_SIZE,
});

// PO-007: a single-key object covers the frame sub-settings. Same
// granularity NICE-006 used for `{ title, subtitle }` — keeps storage.js
// from sprouting sibling keys for one feature. padding/margin/radius (this
// milestone) extend the live-preview-capable frame; see the live overlay
// module for the shared geometry contract (margin → thickness → padding →
// map, outside in).
const DEFAULT_EXPORT_FRAME = Object.freeze({
  enabled: false,
  thickness: 60,
  color: "#ffffff",
  shadow: false,
  padding: 0,
  margin: 0,
  radius: 0,
});
const FRAME_THICKNESS_MIN = 0;
const FRAME_THICKNESS_MAX = 200;
// padding/margin/radius share thickness's 0–200 range — same physical
// scale (a frame band/mat/corner can't usefully exceed that on any
// preset), so one pair of bounds covers all four dimensions.
const FRAME_PADDING_MIN = 0;
const FRAME_PADDING_MAX = 200;
const FRAME_MARGIN_MIN = 0;
const FRAME_MARGIN_MAX = 200;
const FRAME_RADIUS_MIN = 0;
const FRAME_RADIUS_MAX = 200;

let bannerTimer = null;

export function loadPins() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved pins could not be read; starting empty.");
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("saved pins is not an array");
    // Element-level validation (FBL-014): a null/malformed element used to
    // pass through verbatim and later crash init() (pin-list sorts on
    // a.createdAt) or load as an invisible ghost pin re-persisted forever.
    const { items, dropped } = normalizeLoadedPins(parsed);
    reportLoadDropped(dropped, "pin");
    return items;
  } catch (err) {
    console.error("saved pins corrupt; ignoring:", err);
    showError("Saved pins were corrupted and have been ignored.");
    return [];
  }
}

export function savePins(pins) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch (err) {
    console.error("failed to save pins:", err);
    showError(
      "Could not save pins (storage may be full). Changes are kept in memory only."
    );
  }
}

// Group entities live under a separate key so each store's serialization
// stays independent (NICE-004 notes). Same defensive shape as loadPins:
// a missing key is "no groups", a corrupt key is logged, banner-flagged,
// and treated as empty.
export function loadGroups() {
  let raw;
  try {
    raw = localStorage.getItem(GROUPS_STORAGE_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved groups could not be read; starting empty.");
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("saved groups is not an array");
    // Element-level validation (FBL-014) — same rationale as loadPins.
    const { items, dropped } = normalizeLoadedGroups(parsed);
    reportLoadDropped(dropped, "group");
    return items;
  } catch (err) {
    console.error("saved groups corrupt; ignoring:", err);
    showError("Saved groups were corrupted and have been ignored.");
    return [];
  }
}

export function saveGroups(groups) {
  try {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups));
  } catch (err) {
    console.error("failed to save groups:", err);
    showError(
      "Could not save groups (storage may be full). Changes are kept in memory only."
    );
  }
}

// User-uploaded custom icons (PIL-001). Same shape as loadPins/loadGroups:
// missing key → empty array, corrupt key → empty + banner. The store itself
// lives in user-icons.js; this module owns the localStorage round-trip.
export function loadUserIcons() {
  let raw;
  try {
    raw = localStorage.getItem(USER_ICONS_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved custom icons could not be read; starting empty.");
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("saved user icons is not an array");
    // Element-level validation (FBL-014) — same rationale as loadPins.
    const { items, dropped } = normalizeLoadedUserIcons(parsed);
    reportLoadDropped(dropped, "custom icon");
    return items;
  } catch (err) {
    console.error("saved user icons corrupt; ignoring:", err);
    showError("Saved custom icons were corrupted and have been ignored.");
    return [];
  }
}

export function saveUserIcons(icons) {
  try {
    localStorage.setItem(USER_ICONS_KEY, JSON.stringify(icons));
  } catch (err) {
    console.error("failed to save user icons:", err);
    showError(
      "Could not save custom icons (storage may be full). Changes are kept in memory only."
    );
  }
}

export function attachUserIconStorage(userIconStore) {
  userIconStore.replaceAll(loadUserIcons());
  return userIconStore.subscribe(saveUserIcons);
}

// ── Boot-time element normalizers (FBL-014) ──────────────────────────────
//
// The load functions above used to pass array elements through verbatim
// once the top-level value proved to be an array. A single bad element (a
// `null` from a truncated write, a pin with a string `lat`) then either
// crashed init() outright — pin-list.js sorts pins on `a.createdAt`, and a
// null element throws a TypeError that aborts ALL of app.js's init() with no
// recovery on reload — or loaded as an invisible "ghost" pin that MapLibre
// silently drops yet savePins re-persists forever.
//
// These mirror js/backup.js's import-path normalizers (the repo's existing
// precedent for exactly this): drop non-object entries, drop entries with
// non-finite / out-of-range coordinates or no name, and default the rest to
// the same fallbacks the import path uses. Optional fields follow the
// data-model contract — a stale group/icon reference is preserved (never a
// reason to drop) and an absent originalLat/originalLon pair stays absent.
//
// Kept here rather than imported from backup.js: backup.js already imports
// from this module, so importing back would form a cycle. The small
// duplication is the smaller, more localized change (F4 owns only storage.js).

// Coerce a raw coordinate to a finite number, or null when blank/absent/
// unparseable. Mirrors backup.js toFiniteNumber — Number("") and Number(null)
// both yield 0, which without this guard would smuggle a (0,0) pin past the
// range check.
function toFiniteNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeLoadedPins(rawPins) {
  const items = [];
  let dropped = 0;
  for (const raw of rawPins) {
    if (!raw || typeof raw !== "object") {
      dropped++;
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
      dropped++;
      continue;
    }
    const pin = {
      id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
      name: raw.name,
      lat,
      lon,
      color: typeof raw.color === "string" && raw.color ? raw.color : DEFAULT_PIN_COLOR,
      group: typeof raw.group === "string" ? raw.group : null,
      icon: typeof raw.icon === "string" ? raw.icon : null,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    };
    // Carry the geocoded origin (FBL-008) only when BOTH values are finite
    // and in range — never invent an origin; a pin lacking them stays
    // button-less (pre-FBL-008 contract), same as the import path.
    const originalLat = toFiniteNumber(raw.originalLat);
    const originalLon = toFiniteNumber(raw.originalLon);
    if (
      originalLat !== null && originalLat >= -90 && originalLat <= 90 &&
      originalLon !== null && originalLon >= -180 && originalLon <= 180
    ) {
      pin.originalLat = originalLat;
      pin.originalLon = originalLon;
    }
    items.push(pin);
  }
  return { items, dropped };
}

function normalizeLoadedGroups(rawGroups) {
  const items = [];
  let dropped = 0;
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== "object") {
      dropped++;
      continue;
    }
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      dropped++;
      continue;
    }
    items.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
      name: raw.name,
      color: typeof raw.color === "string" && HEX_COLOR_RE.test(raw.color)
        ? raw.color
        : DEFAULT_GROUP_COLOR,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    });
  }
  return { items, dropped };
}

function normalizeLoadedUserIcons(rawIcons) {
  const items = [];
  let dropped = 0;
  for (const raw of rawIcons) {
    if (!raw || typeof raw !== "object") {
      dropped++;
      continue;
    }
    // fillSvg is the only irreparable field: an icon with no markup can't
    // render. Unlike backup.js's import path, the SVG is NOT re-run through
    // ingestSvg here — the user-icon store already sanitized every entry on
    // the way in, and re-sanitizing the whole library on every boot would put
    // svg-ingest on the critical init path for no correctness gain.
    if (typeof raw.fillSvg !== "string" || raw.fillSvg.length === 0) {
      dropped++;
      continue;
    }
    items.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
      name: typeof raw.name === "string" ? raw.name : "",
      tintable: Boolean(raw.tintable),
      fillSvg: raw.fillSvg,
      attribution: normalizeLoadedAttribution(raw.attribution),
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    });
  }
  return { items, dropped };
}

function normalizeLoadedAttribution(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    artistName: typeof raw.artistName === "string" ? raw.artistName : null,
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : null,
  };
}

// One summary banner per load when entries were dropped — never silent
// (CLAUDE.md error convention), mirroring backup.js's reportDropped tone.
function reportLoadDropped(count, noun) {
  if (count <= 0) return;
  showError(
    `Skipped ${count} saved ${noun}${count === 1 ? "" : "s"} that couldn't be read; everything else was loaded.`
  );
}

// Map-style preference. Stored as a bare string (not JSON) — the value is a
// short id like "osm" or "carto-light" and JSON.stringify/parse would only
// add quote-wrapping noise to the stored value. Returns `null` when nothing
// is saved or the read fails, so callers can fall back to a default.
export function loadMapStyle() {
  try {
    return localStorage.getItem(MAP_STYLE_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved map style could not be read; using default.");
    return null;
  }
}

export function saveMapStyle(styleId) {
  try {
    localStorage.setItem(MAP_STYLE_KEY, styleId);
  } catch (err) {
    console.error("failed to save map style:", err);
    showError(
      "Could not save map style preference. Choice will reset on refresh."
    );
  }
}

// Route visibility preference. Stored as the literal "true" / "false" string
// to mirror the bare-string convention used for map style (no JSON noise).
// Anything other than "true" — including null on first load and a corrupt
// value — is treated as `false` so the first-time experience is the plain
// map without a line.
export function loadRouteVisible() {
  try {
    return localStorage.getItem(ROUTE_VISIBLE_KEY) === "true";
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    return false;
  }
}

export function saveRouteVisible(visible) {
  try {
    localStorage.setItem(ROUTE_VISIBLE_KEY, visible ? "true" : "false");
  } catch (err) {
    console.error("failed to save route visibility:", err);
    showError(
      "Could not save route preference. Choice will reset on refresh."
    );
  }
}

// Export-format preset id (NICE-007). Stored as a bare string, mirroring
// loadMapStyle — the value is a short id like "current" or "a4-portrait"
// and JSON wrapping would only add quote noise. A missing or unreadable
// value falls back to "current" so the first-time user gets the same
// behaviour as CORE-012 / NICE-006 with no preset selected.
export function loadExportFormat() {
  try {
    return localStorage.getItem(EXPORT_FORMAT_KEY) ?? DEFAULT_EXPORT_FORMAT;
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved export format could not be read; using default.");
    return DEFAULT_EXPORT_FORMAT;
  }
}

export function saveExportFormat(formatId) {
  try {
    localStorage.setItem(EXPORT_FORMAT_KEY, formatId);
  } catch (err) {
    console.error("failed to save export format:", err);
    showError(
      "Could not save export format preference. Choice will reset on refresh."
    );
  }
}

// Decorative export frame (PO-007). Single-key object — see
// DEFAULT_EXPORT_FRAME above. Same defensive shape as loadOnMapTitle:
// missing key → defaults; corrupt key → defaults + banner. Each field is
// individually validated so a partial / hand-edited object can never poison
// the export pipeline (e.g. NaN thickness, non-string color).
export function loadExportFrame() {
  let raw;
  try {
    raw = localStorage.getItem(EXPORT_FRAME_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved frame settings could not be read; using defaults.");
    return { ...DEFAULT_EXPORT_FRAME };
  }
  if (raw === null) return { ...DEFAULT_EXPORT_FRAME };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("saved frame settings is not an object");
    }
    return normalizeFrame(parsed);
  } catch (err) {
    console.error("saved frame settings corrupt; ignoring:", err);
    showError("Saved frame settings were corrupted and have been ignored.");
    return { ...DEFAULT_EXPORT_FRAME };
  }
}

export function saveExportFrame(value) {
  try {
    localStorage.setItem(EXPORT_FRAME_KEY, JSON.stringify(normalizeFrame(value)));
  } catch (err) {
    console.error("failed to save frame settings:", err);
    showError(
      "Could not save frame settings (storage may be full). Changes are kept in memory only."
    );
  }
}

// Field-by-field clamp/coerce so callers can pass partial objects (e.g.
// `{ enabled: true }` from a single change event) and get a complete
// well-formed value back. Unknown keys are dropped on the floor.
//
// Exported (FBL-013) so app.js can normalize a LIVE DOM frame read into the
// exact same shape loadExportFrame() returns and hand it to the export
// pipeline — keeping the exported PNG in step with the on-map overlay even
// when a save failed and localStorage still holds the stale value.
export function normalizeFrame(value) {
  const v = value || {};
  const thicknessNum = Number(v.thickness);
  const thickness = Number.isFinite(thicknessNum)
    ? Math.max(FRAME_THICKNESS_MIN, Math.min(FRAME_THICKNESS_MAX, Math.round(thicknessNum)))
    : DEFAULT_EXPORT_FRAME.thickness;
  const color =
    typeof v.color === "string" && /^#[0-9a-fA-F]{6}$/.test(v.color)
      ? v.color
      : DEFAULT_EXPORT_FRAME.color;
  const paddingNum = Number(v.padding);
  const padding = Number.isFinite(paddingNum)
    ? Math.max(FRAME_PADDING_MIN, Math.min(FRAME_PADDING_MAX, Math.round(paddingNum)))
    : DEFAULT_EXPORT_FRAME.padding;
  const marginNum = Number(v.margin);
  const margin = Number.isFinite(marginNum)
    ? Math.max(FRAME_MARGIN_MIN, Math.min(FRAME_MARGIN_MAX, Math.round(marginNum)))
    : DEFAULT_EXPORT_FRAME.margin;
  const radiusNum = Number(v.radius);
  const radius = Number.isFinite(radiusNum)
    ? Math.max(FRAME_RADIUS_MIN, Math.min(FRAME_RADIUS_MAX, Math.round(radiusNum)))
    : DEFAULT_EXPORT_FRAME.radius;
  return {
    enabled: Boolean(v.enabled),
    thickness,
    color,
    shadow: Boolean(v.shadow),
    padding,
    margin,
    radius,
  };
}

// Hide-labels preference (PO-001). Same bare-string "true" / "false"
// convention as loadRouteVisible — anything other than "true" (including
// null on first load) is treated as `false` so the first-time experience
// keeps every basemap's native labels.
export function loadHideLabels() {
  try {
    return localStorage.getItem(HIDE_LABELS_KEY) === "true";
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    return false;
  }
}

export function saveHideLabels(value) {
  try {
    localStorage.setItem(HIDE_LABELS_KEY, value ? "true" : "false");
  } catch (err) {
    console.error("failed to save hide-labels preference:", err);
    showError(
      "Could not save hide-labels preference. Choice will reset on refresh."
    );
  }
}

// On-map title (PO-008/009). Single-key object — see EMPTY_ON_MAP_TITLE
// above. Same defensive load shape as loadExportFrame: missing key →
// defaults, corrupt key → defaults + banner. Each field individually
// validated through normalizeOnMapTitle so a partial / hand-edited
// object can never poison the export pipeline (e.g. non-finite lon, an
// unknown font string, a bad color hex).
export function loadOnMapTitle() {
  let raw;
  try {
    raw = localStorage.getItem(ON_MAP_TITLE_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved on-map title could not be read; starting empty.");
    return { ...EMPTY_ON_MAP_TITLE };
  }
  if (raw === null) return { ...EMPTY_ON_MAP_TITLE };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("saved on-map title is not an object");
    }
    return normalizeOnMapTitle(parsed);
  } catch (err) {
    console.error("saved on-map title corrupt; ignoring:", err);
    showError("Saved on-map title was corrupted and has been ignored.");
    return { ...EMPTY_ON_MAP_TITLE };
  }
}

export function saveOnMapTitle(value) {
  try {
    localStorage.setItem(
      ON_MAP_TITLE_KEY,
      JSON.stringify(normalizeOnMapTitle(value))
    );
  } catch (err) {
    console.error("failed to save on-map title:", err);
    showError(
      "Could not save on-map title (storage may be full). Changes are kept in memory only."
    );
  }
}

// Field-by-field clamp/coerce so callers can pass partial objects (e.g.
// `{ bold: true }` from a single toggle event) and get a complete
// well-formed value back. Unknown keys are dropped on the floor; an
// unknown font fontstack falls back to the default rather than
// silently rendering with whatever the browser maps it to.
function normalizeOnMapTitle(value) {
  const v = value || {};
  const sizeNum = Number(v.size);
  const size = Number.isFinite(sizeNum)
    ? Math.max(
        ON_MAP_TITLE_SIZE_MIN,
        Math.min(ON_MAP_TITLE_SIZE_MAX, Math.round(sizeNum))
      )
    : DEFAULT_ON_MAP_TITLE_SIZE;
  const color =
    typeof v.color === "string" && /^#[0-9a-fA-F]{6}$/.test(v.color)
      ? v.color
      : DEFAULT_ON_MAP_TITLE_COLOR;
  const font =
    typeof v.font === "string" && ON_MAP_TITLE_FONTS.includes(v.font)
      ? v.font
      : DEFAULT_ON_MAP_TITLE_FONT;
  return {
    text: typeof v.text === "string" ? v.text : "",
    lon: Number.isFinite(v.lon) ? v.lon : null,
    lat: Number.isFinite(v.lat) ? v.lat : null,
    font,
    bold: Boolean(v.bold),
    italic: Boolean(v.italic),
    color,
    size,
  };
}

// Hydrate first, subscribe second — see CORE-004 notes. Reversing this order
// would write loaded state straight back to storage, including overwriting
// good data with `[]` after a corruption-recovery load.
export function attachStorage(pinStore) {
  pinStore.replaceAll(loadPins());
  return pinStore.subscribe(savePins);
}

// Same hydrate-then-subscribe contract as attachStorage. Both stores use
// the same shape so the call sites in app.js stay symmetric.
export function attachGroupStorage(groupStore) {
  groupStore.replaceAll(loadGroups());
  return groupStore.subscribe(saveGroups);
}

export function showError(message) {
  const banner = document.getElementById("error-banner");
  if (!banner) {
    console.warn("error-banner element missing; message:", message);
    return;
  }
  banner.textContent = message;
  banner.hidden = false;
  if (bannerTimer !== null) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    banner.hidden = true;
    bannerTimer = null;
  }, BANNER_TIMEOUT_MS);
}

// Per-provider API key load/save. Mirrors the bare-string convention of
// loadMapStyle/saveMapStyle — values are short opaque strings, JSON wrapping
// would only add quote noise. Empty string and missing-key are equivalent
// ("not set"). Unknown providers are no-ops, not throws, so a stale provider
// id from older app state can never crash the boot path.
export function loadApiKey(provider) {
  const storageKey = API_KEY_STORAGE_BY_PROVIDER[provider];
  if (!storageKey) return "";
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch (err) {
    console.error("localStorage unavailable on api key read:", err);
    return "";
  }
}

export function saveApiKey(provider, value) {
  const storageKey = API_KEY_STORAGE_BY_PROVIDER[provider];
  if (!storageKey) return;
  try {
    if (value) {
      localStorage.setItem(storageKey, value);
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch (err) {
    console.error("failed to save api key:", err);
    showError(
      "Could not save API key (storage may be full). It will reset on refresh."
    );
  }
}

export function loadAllApiKeys() {
  return {
    stadia: loadApiKey("stadia"),
    maptiler: loadApiKey("maptiler"),
    thunderforest: loadApiKey("thunderforest"),
  };
}
