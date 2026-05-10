const STORAGE_KEY = "city-pin-map.pins.v1";
const GROUPS_STORAGE_KEY = "city-pin-map.groups.v1";
const MAP_STYLE_KEY = "city-pin-map.map-style.v1";
const ROUTE_VISIBLE_KEY = "city-pin-map.route-visible.v1";
const EXPORT_TEXT_KEY = "city-pin-map.export-text.v1";
const EXPORT_FORMAT_KEY = "city-pin-map.export-format.v1";
const EXPORT_FRAME_KEY = "city-pin-map.export-frame.v1";
const HIDE_LABELS_KEY = "city-pin-map.hide-labels.v1";

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
const EMPTY_EXPORT_TEXT = Object.freeze({ title: "", subtitle: "" });

// PO-007: a single-key object covers the four frame sub-settings. Same
// granularity NICE-006 used for `{ title, subtitle }` — keeps storage.js
// from sprouting four sibling keys for one feature.
const DEFAULT_EXPORT_FRAME = Object.freeze({
  enabled: false,
  thickness: 60,
  color: "#ffffff",
  shadow: false,
});
const FRAME_THICKNESS_MIN = 0;
const FRAME_THICKNESS_MAX = 200;

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
    return parsed;
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
    return parsed;
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
    return parsed;
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

// Export title / subtitle. Same defensive shape as loadPins/loadGroups: a
// missing key returns the empty defaults; a corrupt value (non-object, or
// JSON parse error) is logged + banner-flagged and treated as empty. Each
// returned object is a fresh copy so callers can safely mutate it.
export function loadExportText() {
  let raw;
  try {
    raw = localStorage.getItem(EXPORT_TEXT_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved export text could not be read; starting empty.");
    return { ...EMPTY_EXPORT_TEXT };
  }
  if (raw === null) return { ...EMPTY_EXPORT_TEXT };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("saved export text is not an object");
    }
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : "",
    };
  } catch (err) {
    console.error("saved export text corrupt; ignoring:", err);
    showError("Saved export text was corrupted and has been ignored.");
    return { ...EMPTY_EXPORT_TEXT };
  }
}

export function saveExportText({ title, subtitle }) {
  try {
    localStorage.setItem(
      EXPORT_TEXT_KEY,
      JSON.stringify({ title: title ?? "", subtitle: subtitle ?? "" })
    );
  } catch (err) {
    console.error("failed to save export text:", err);
    showError(
      "Could not save export text (storage may be full). Changes are kept in memory only."
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
// DEFAULT_EXPORT_FRAME above. Same defensive shape as loadExportText:
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
function normalizeFrame(value) {
  const v = value || {};
  const thicknessNum = Number(v.thickness);
  const thickness = Number.isFinite(thicknessNum)
    ? Math.max(FRAME_THICKNESS_MIN, Math.min(FRAME_THICKNESS_MAX, Math.round(thicknessNum)))
    : DEFAULT_EXPORT_FRAME.thickness;
  const color =
    typeof v.color === "string" && /^#[0-9a-fA-F]{6}$/.test(v.color)
      ? v.color
      : DEFAULT_EXPORT_FRAME.color;
  return {
    enabled: Boolean(v.enabled),
    thickness,
    color,
    shadow: Boolean(v.shadow),
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
