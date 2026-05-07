const STORAGE_KEY = "city-pin-map.pins.v1";
const GROUPS_STORAGE_KEY = "city-pin-map.groups.v1";
const MAP_STYLE_KEY = "city-pin-map.map-style.v1";
const ROUTE_VISIBLE_KEY = "city-pin-map.route-visible.v1";
const EXPORT_TEXT_KEY = "city-pin-map.export-text.v1";
const BANNER_TIMEOUT_MS = 6000;
const EMPTY_EXPORT_TEXT = Object.freeze({ title: "", subtitle: "" });

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
