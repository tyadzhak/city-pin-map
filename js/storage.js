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
// Side-tabs restructuring: which of the three side-panel tabs (Design /
// Pins / Groups) was last active. Bare-string convention, mirroring
// EXPORT_FORMAT_KEY — the value is a short id and JSON wrapping would only
// add quote noise.
const SIDE_TAB_KEY = "city-pin-map.side-tab.v1";
const EXPORT_FRAME_KEY = "city-pin-map.export-frame.v1";
// Bottom fade (poster-style caption zone): a white/color gradient that
// dissolves the map into a solid color at the bottom edge. Own standalone
// key, independent of the frame set above — see DEFAULT_BOTTOM_FADE.
const BOTTOM_FADE_KEY = "city-pin-map.bottom-fade.v1";
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

// Side-tabs restructuring — valid tab ids and the default. "design" is
// first/default per the spec: it's the tab a returning user most likely
// wants (export/title/frame config), and it's always a safe landing spot
// even for a first-time user who has never touched pins or groups yet.
const VALID_SIDE_TABS = Object.freeze(["design", "pins", "groups"]);
const DEFAULT_SIDE_TAB = "design";

// Fallback color for a saved group whose stored color isn't a 6-digit hex.
// Mirrors backup.js's DEFAULT_GROUP_COLOR (the first shade group-panel.js
// ships new groups with) so a repaired group looks native rather than flagged.
const DEFAULT_GROUP_COLOR = "#e63946";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// PO-008/009 — on-map title state. The anchor (nx/ny) is a normalized
// frame-relative fraction of the map container / export crop, not map
// geography, so the title stays fixed on-screen across pan/zoom — see
// EMPTY_ON_MAP_TITLE and normalizeOnMapTitle below.
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
// PER-LINE title model (this milestone): the title is now a BLOCK anchored
// at (nx, ny) — same frame-relative-fraction meaning as before — containing
// an ORDERED list of independently-styled lines rendered top-to-bottom.
// Replaces the old single text/font/bold/italic/color/size-at-top-level
// shape (PO-008/009). `lines: []` (renderable == false) is the "no title"
// state; the overlay hides whenever every line's text is empty. See
// normalizeOnMapTitle / normalizeTitleLine / defaultTitleLine below.
//
// NOT exported (mirrors DEFAULT_EXPORT_FRAME / DEFAULT_BOTTOM_FADE, which
// also stay module-private) — callers get a fresh copy via loadOnMapTitle()
// or normalizeOnMapTitle(), never this singleton directly. `lines` here is
// only ever read through normalizeOnMapTitle's `.map()`, which always
// returns a brand-new array, so nothing can mutate this shared reference.
const EMPTY_ON_MAP_TITLE = Object.freeze({
  nx: 0.5,
  ny: 0.85,
  lines: [],
});

// PO-007 (+ two-frames extension, this milestone): a single-key object
// covers the frame sub-settings. Same granularity NICE-006 used for
// `{ title, subtitle }` — keeps storage.js from sprouting sibling keys for
// one feature. padding/margin/radius extend the live-preview-capable frame;
// see the live overlay module for the shared geometry contract (margin →
// thickness → padding → map, outside in).
//
// The persisted shape is a FRAME SET: `{ frames: [frameElement, frameElement],
// outside }`, `frames` always exactly two elements ("Frame 1" at index 0,
// "Frame 2" at index 1), each the same 7-field shape a single frame always
// had. Two independently nested bands (different margins) produce the
// double-frame look. Frame 1's defaults are unchanged from the original
// single-frame feature; Frame 2 defaults to a thin black band nested just
// inside Frame 1 so enabling it immediately shows a sensible result. A
// legacy pre-two-frames value (a bare single frame object, no `frames`
// array) is migrated into Frame 1 on load, with Frame 2 seeded from its own
// defaults — see loadExportFrame. `outside` (this milestone) controls what
// fills the region beyond the outermost ENABLED frame's outer edge — see
// DEFAULT_FRAME_OUTSIDE / normalizeFrameOutside below.
const DEFAULT_EXPORT_FRAME = Object.freeze({
  enabled: false,
  thickness: 60,
  color: "#ffffff",
  shadow: false,
  padding: 0,
  margin: 0,
  radius: 0,
});
const DEFAULT_EXPORT_FRAME_2 = Object.freeze({
  enabled: false,
  thickness: 4,
  color: "#000000",
  shadow: false,
  padding: 0,
  margin: 16,
  radius: 0,
});
// Field names that make a parsed object "look like" a legacy single-frame
// value (pre-two-frames). Any one present (and no `frames` array) is enough
// to trigger the migration path in loadExportFrame — a corrupt object with
// none of these fields is treated as unrecognizable and falls back to
// defaults + banner instead.
const LEGACY_FRAME_FIELDS = Object.freeze([
  "enabled",
  "thickness",
  "color",
  "padding",
  "margin",
  "radius",
  "shadow",
]);
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

// OUTSIDE-frame treatment: what fills the region beyond the outer edge of
// the OUTERMOST ENABLED frame element — i.e. the margin band between the
// canvas edge and that frame's outer rounded-rect. "none" leaves it as the
// bare map (today's behavior); "white" fills it with `color`; "blur" renders
// that region blurred. If NO frame element is enabled there is no boundary
// to paint against, so the feature is a documented no-op regardless of mode
// — the consumer (export.js / map-frame.js) is expected to check "is any
// frame enabled" before applying this.
const DEFAULT_FRAME_OUTSIDE = Object.freeze({
  mode: "none",
  color: "#ffffff",
  blur: 8,
});
const FRAME_OUTSIDE_MODES = Object.freeze(["none", "white", "blur"]);
const FRAME_OUTSIDE_BLUR_MIN = 0;
const FRAME_OUTSIDE_BLUR_MAX = 50;

// Fresh (unfrozen, independently mutable) frame-set defaults. Never return
// DEFAULT_EXPORT_FRAME/DEFAULT_EXPORT_FRAME_2/DEFAULT_FRAME_OUTSIDE
// directly here — those are frozen module-level singletons; a caller
// mutating the returned object (e.g. app.js's readFrame-style DOM
// hydration) must never reach back and corrupt the shared default.
function freshDefaultFrameSet() {
  return {
    frames: [{ ...DEFAULT_EXPORT_FRAME }, { ...DEFAULT_EXPORT_FRAME_2 }],
    outside: { ...DEFAULT_FRAME_OUTSIDE },
  };
}

// Bottom fade: `height` is a PERCENTAGE of the map/canvas height (0-100),
// not a pixel count — unlike the frame's px-based thickness/margin/padding.
// The live preview (js/map-fade.js) and the exported PNG (js/export.js) are
// two different pixel spaces (CSS pixels for the on-screen overlay, device
// or preset pixels for the export canvas) that can also differ from each
// OTHER preset to preset. A percentage of each surface's own height is the
// only value that reads identically on-screen and across every export
// preset without a per-path conversion factor — the same rationale
// EXPORT_PRESETS documents for coeff-based typography scaling, applied here
// to geometry instead.
// `intensity` is a PERCENTAGE (0-100) of the band (measured from the bottom
// edge) that stays FULLY OPAQUE before the ramp to transparent begins — a
// gradient color-stop split, not a second band. 50 is a visibly stronger
// default than the old pure-linear look (intensity 0); existing saved fades
// from before this field existed backfill to 50 on load via
// normalizeBottomFade below, same as every other field's default-backfill
// contract in this file.
const DEFAULT_BOTTOM_FADE = Object.freeze({
  enabled: false,
  height: 30,
  color: "#ffffff",
  intensity: 50,
});
const FADE_HEIGHT_MIN = 0;
const FADE_HEIGHT_MAX = 100;
const FADE_INTENSITY_MIN = 0;
const FADE_INTENSITY_MAX = 100;

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
    // The bytes ARE readable here (raw is a non-null string) — preserve them
    // before the empty-hydrate + first mutation overwrites the original
    // (FBL-015), then tell the user where recovery lives.
    const stashed = stashCorruptValue(STORAGE_KEY, raw);
    showError(corruptBannerMessage("pins", STORAGE_KEY, stashed));
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
    const stashed = stashCorruptValue(GROUPS_STORAGE_KEY, raw);
    showError(corruptBannerMessage("groups", GROUPS_STORAGE_KEY, stashed));
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
    const stashed = stashCorruptValue(USER_ICONS_KEY, raw);
    showError(corruptBannerMessage("custom icons", USER_ICONS_KEY, stashed));
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

// ── Import pre-verify (FBL-016) ───────────────────────────────────────────
//
// backup.js's importFromJson replaces three stores in sequence — groups,
// pins, user icons — each firing its own save subscriber. saveUserIcons is
// the largest payload (icon SVGs) and, like the other save functions,
// catches a setItem quota failure with only a transient banner and no
// rethrow. So a quota-busting import used to persist groups + pins while
// user icons silently fell on the floor: in memory everything looked
// imported, but on reload part of it was gone and pins referencing the
// missing icons degraded to the default.
//
// This helper proves the ENTIRE import fits BEFORE any store is mutated. It
// serializes each payload exactly as its save function would (JSON.stringify
// of the store array) and writes all three keys up front inside one
// try/catch. On ANY failure it restores every key it already overwrote to
// the exact raw bytes read before the attempt — so a partial pre-verify
// can't itself tear on-disk state — and returns false; the caller then
// aborts the import without touching a single store. On success it returns
// true and the subsequent replaceAll subscribers rewrite the identical
// bytes (idempotent: the store's post-replaceAll snapshot is the same array
// this pre-write serialized).
//
// `userIcons` is written only when provided (non-null): a v1 import leaves
// the user-icon library untouched, mirroring importFromJson's isV2 gate.
// Keys live here (storage.js owns every localStorage key) so backup.js need
// not learn their names.
export function prewriteImportPayloads({ pins, groups, userIcons }) {
  const writes = [
    [STORAGE_KEY, JSON.stringify(pins)],
    [GROUPS_STORAGE_KEY, JSON.stringify(groups)],
  ];
  if (userIcons != null) {
    writes.push([USER_ICONS_KEY, JSON.stringify(userIcons)]);
  }

  // Snapshot the pre-attempt raw bytes of every key we're about to touch so
  // any mid-way failure can roll each one back to exactly what it held.
  const previous = writes.map(([key]) => [key, localStorage.getItem(key)]);

  const writtenKeys = [];
  try {
    for (const [key, serialized] of writes) {
      localStorage.setItem(key, serialized);
      writtenKeys.push(key);
    }
    return true;
  } catch (err) {
    console.error("import pre-verify failed to persist; aborting import:", err);
    for (const [key, raw] of previous) {
      if (!writtenKeys.includes(key)) continue;
      try {
        if (raw === null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, raw);
        }
      } catch (restoreErr) {
        console.error("failed to restore key during import rollback:", key, restoreErr);
      }
    }
    return false;
  }
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
// duplication is the smaller, more localized change.

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
    // labelDx/labelDy (per-pin label drag offset, screen px): optional,
    // like originalLat/originalLon — only carried over when finite, else
    // omitted entirely so a consumer's `pin.labelDx ?? 0` fallback applies.
    const labelDx = toFiniteNumber(raw.labelDx);
    if (labelDx !== null) pin.labelDx = labelDx;
    const labelDy = toFiniteNumber(raw.labelDy);
    if (labelDy !== null) pin.labelDy = labelDy;
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

// ── Corrupt-value recovery stash (FBL-015) ───────────────────────────────
//
// When a stored array value is present but unparseable, the load path returns
// []. attachStorage then hydrates the empty store and subscribes the save
// function, so the user's first mutation persists over the original bytes —
// even though those bytes were READABLE and possibly hand-fixable. Before that
// window opens, copy the raw string to a sibling "<key>.corrupt" key so the
// original survives the overwrite and can be recovered from devtools / re-import.
//
// Scope: only the getItem-throws path can't stash (there the bytes are
// genuinely unreadable — left as banner + default). The object-shaped
// preference stores (frame/title) are field-normalized and low-value, so they
// keep the plain banner. Returns whether the stash was written so the banner
// can be honest about recovery availability. Guarded in try/catch: a full disk
// must make recovery a silent no-op, never turn a corrupt read into a crash.
function stashCorruptValue(storageKey, raw) {
  try {
    localStorage.setItem(`${storageKey}.corrupt`, raw);
    return true;
  } catch (err) {
    console.error("failed to stash corrupt value for recovery:", err);
    return false;
  }
}

function corruptBannerMessage(noun, storageKey, stashed) {
  const base = `Saved ${noun} were corrupted and have been ignored.`;
  return stashed
    ? `${base} The original data was preserved under "${storageKey}.corrupt" for recovery.`
    : base;
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

// Active side-panel tab (side-tabs restructuring). Same bare-string,
// unreadable-falls-back-to-default shape as loadExportFormat — a missing
// key, an unknown id (older app version, hand-edited storage), or a read
// failure all degrade to DEFAULT_SIDE_TAB rather than crashing or leaving
// no tab active.
export function loadActiveSideTab() {
  let value;
  try {
    value = localStorage.getItem(SIDE_TAB_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    return DEFAULT_SIDE_TAB;
  }
  return VALID_SIDE_TABS.includes(value) ? value : DEFAULT_SIDE_TAB;
}

export function saveActiveSideTab(id) {
  // Guard against persisting a bogus id — a caller bug should never be able
  // to write something loadActiveSideTab would then have to reject.
  if (!VALID_SIDE_TABS.includes(id)) return;
  try {
    localStorage.setItem(SIDE_TAB_KEY, id);
  } catch (err) {
    console.error("failed to save active side tab:", err);
    showError(
      "Could not save side panel tab preference. Choice will reset on refresh."
    );
  }
}

// Decorative export frame SET (PO-007 + two-frames extension). Single-key
// object — see DEFAULT_EXPORT_FRAME / DEFAULT_EXPORT_FRAME_2 above. Same
// defensive shape as loadOnMapTitle: missing key → defaults; corrupt key →
// defaults + banner. Always returns exactly `{ frames: [f0, f1] }`, each
// element individually validated (via normalizeFrame) so a partial /
// hand-edited object can never poison the export pipeline (e.g. NaN
// thickness, non-string color).
//
// Migration: a value saved by the pre-two-frames build is a bare single
// frame object (no `frames` array). That legacy shape is detected by the
// presence of any of LEGACY_FRAME_FIELDS and migrated into Frame 1,
// preserving the user's existing configuration; Frame 2 is seeded from its
// own defaults. The storage KEY is unchanged — this migration is shape-only,
// not a key bump — and the frame is a UI preference, not part of the JSON
// backup format, so no backup version bump applies here either.
export function loadExportFrame() {
  let raw;
  try {
    raw = localStorage.getItem(EXPORT_FRAME_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved frame settings could not be read; using defaults.");
    return freshDefaultFrameSet();
  }
  if (raw === null) return freshDefaultFrameSet();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("saved frame settings is not an object");
    }
    if (Array.isArray(parsed.frames)) {
      return normalizeFrameSet(parsed);
    }
    const looksLikeLegacyFrame = LEGACY_FRAME_FIELDS.some((key) =>
      Object.prototype.hasOwnProperty.call(parsed, key)
    );
    if (looksLikeLegacyFrame) {
      return {
        frames: [normalizeFrame(parsed), { ...DEFAULT_EXPORT_FRAME_2 }],
        outside: { ...DEFAULT_FRAME_OUTSIDE },
      };
    }
    throw new Error("saved frame settings is neither a frame set nor a recognizable legacy frame");
  } catch (err) {
    console.error("saved frame settings corrupt; ignoring:", err);
    showError("Saved frame settings were corrupted and have been ignored.");
    return freshDefaultFrameSet();
  }
}

export function saveExportFrame(value) {
  try {
    localStorage.setItem(EXPORT_FRAME_KEY, JSON.stringify(normalizeFrameSet(value)));
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

// Normalizes a FRAME SET — `{ frames: [frameElement, frameElement], outside
// }` — element-by-element through normalizeFrame above, plus the outside-
// frame treatment through normalizeFrameOutside. Always returns exactly two
// frame elements: a missing/non-array `frames`, or a missing element within
// it, falls back to that slot's own default (DEFAULT_EXPORT_FRAME for index
// 0, DEFAULT_EXPORT_FRAME_2 for index 1); any elements beyond index 1 are
// dropped defensively. A missing/malformed `outside` falls back to
// DEFAULT_FRAME_OUTSIDE the same way. Exported (mirrors normalizeFrame's
// FBL-013 export) so app.js can normalize a LIVE DOM read into the exact
// same shape loadExportFrame() returns before handing it to the export
// pipeline.
export function normalizeFrameSet(value) {
  const frames = Array.isArray(value?.frames) ? value.frames : [];
  return {
    frames: [
      normalizeFrame(frames[0] ?? DEFAULT_EXPORT_FRAME),
      normalizeFrame(frames[1] ?? DEFAULT_EXPORT_FRAME_2),
    ],
    outside: normalizeFrameOutside(value?.outside),
  };
}

// Field-by-field clamp/coerce for the outside-frame treatment, mirroring
// normalizeFrame's contract. Exported for the same live-DOM-normalization
// reason as normalizeFrame/normalizeFrameSet.
export function normalizeFrameOutside(value) {
  const v = value || {};
  const mode = FRAME_OUTSIDE_MODES.includes(v.mode) ? v.mode : DEFAULT_FRAME_OUTSIDE.mode;
  const color =
    typeof v.color === "string" && HEX_COLOR_RE.test(v.color)
      ? v.color
      : DEFAULT_FRAME_OUTSIDE.color;
  const blurNum = Number(v.blur);
  const blur = Number.isFinite(blurNum)
    ? Math.max(FRAME_OUTSIDE_BLUR_MIN, Math.min(FRAME_OUTSIDE_BLUR_MAX, Math.round(blurNum)))
    : DEFAULT_FRAME_OUTSIDE.blur;
  return { mode, color, blur };
}

// Bottom fade (poster-style caption zone dissolving the map into a solid
// color at the bottom edge). Same defensive load shape as loadExportFrame:
// missing key → fresh default clone; corrupt key → fresh default clone +
// banner. Never returns the frozen DEFAULT_BOTTOM_FADE singleton directly —
// callers (app.js's readFade-style DOM hydration) may mutate the returned
// object.
export function loadBottomFade() {
  let raw;
  try {
    raw = localStorage.getItem(BOTTOM_FADE_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved bottom fade settings could not be read; using defaults.");
    return { ...DEFAULT_BOTTOM_FADE };
  }
  if (raw === null) return { ...DEFAULT_BOTTOM_FADE };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("saved bottom fade settings is not an object");
    }
    return normalizeBottomFade(parsed);
  } catch (err) {
    console.error("saved bottom fade settings corrupt; ignoring:", err);
    showError("Saved bottom fade settings were corrupted and have been ignored.");
    return { ...DEFAULT_BOTTOM_FADE };
  }
}

export function saveBottomFade(value) {
  try {
    localStorage.setItem(BOTTOM_FADE_KEY, JSON.stringify(normalizeBottomFade(value)));
  } catch (err) {
    console.error("failed to save bottom fade settings:", err);
    showError(
      "Could not save bottom fade settings (storage may be full). Changes are kept in memory only."
    );
  }
}

// Field-by-field clamp/coerce, mirroring normalizeFrame's contract — a
// caller can pass a partial object (e.g. `{ enabled: true }` from a single
// change event, or a live DOM read with a briefly-NaN valueAsNumber) and
// get a complete, well-formed value back. Unknown keys are dropped.
// Exported so app.js can normalize a LIVE DOM read into the exact same
// shape loadBottomFade() returns before handing it to the export pipeline
// (same FBL-013 rationale normalizeFrame/normalizeFrameSet document).
export function normalizeBottomFade(value) {
  const v = value || {};
  const heightNum = Number(v.height);
  const height = Number.isFinite(heightNum)
    ? Math.max(FADE_HEIGHT_MIN, Math.min(FADE_HEIGHT_MAX, Math.round(heightNum)))
    : DEFAULT_BOTTOM_FADE.height;
  const color =
    typeof v.color === "string" && /^#[0-9a-fA-F]{6}$/.test(v.color)
      ? v.color
      : DEFAULT_BOTTOM_FADE.color;
  const intensityNum = Number(v.intensity);
  const intensity = Number.isFinite(intensityNum)
    ? Math.max(FADE_INTENSITY_MIN, Math.min(FADE_INTENSITY_MAX, Math.round(intensityNum)))
    : DEFAULT_BOTTOM_FADE.intensity;
  return {
    enabled: Boolean(v.enabled),
    height,
    color,
    intensity,
  };
}

// Inset map (atlas-style magnifier) — a small framed square box docked in a
// corner of the map that shows a second MapLibre map fitted to the pins of
// one chosen group at higher zoom, plus a "locator rectangle" on the main
// map marking the inset's bounds. Own standalone key, same defensive
// load/clamp/save shape as loadBottomFade/saveBottomFade/normalizeBottomFade.
//
//   - corner ∈ INSET_CORNERS; an invalid/absent value falls back to
//     "top-right" (the default docking corner).
//   - sizePct is the inset box's width as a PERCENTAGE of the MAP CONTAINER
//     width (the box is square), clamped 15–50. A percentage — not a pixel
//     count — so the box keeps the same proportion of the view regardless of
//     the live window size or an export preset's dimensions.
//   - groupId is an id from the groups store, or null. A stale/deleted id
//     (or an empty group) is NOT repaired here — it stays as-is and the
//     inset simply hides itself while the id is unresolvable (js/map-inset.js
//     owns that runtime check; storage only guarantees a string-or-null).
//   - showLocator toggles the locator rectangle on the main map; defaults
//     true, so a saved value from before the field existed backfills to on.
const INSET_KEY = "city-pin-map.inset.v1";
const INSET_CORNERS = Object.freeze([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);
const DEFAULT_INSET = Object.freeze({
  enabled: false,
  corner: "top-right",
  sizePct: 32,
  groupId: null,
  showLocator: true,
});
const INSET_SIZE_MIN = 15;
const INSET_SIZE_MAX = 50;

export function loadInset() {
  let raw;
  try {
    raw = localStorage.getItem(INSET_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved inset map settings could not be read; using defaults.");
    return { ...DEFAULT_INSET };
  }
  if (raw === null) return { ...DEFAULT_INSET };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("saved inset map settings is not an object");
    }
    return normalizeInset(parsed);
  } catch (err) {
    console.error("saved inset map settings corrupt; ignoring:", err);
    showError("Saved inset map settings were corrupted and have been ignored.");
    return { ...DEFAULT_INSET };
  }
}

export function saveInset(value) {
  try {
    localStorage.setItem(INSET_KEY, JSON.stringify(normalizeInset(value)));
  } catch (err) {
    console.error("failed to save inset map settings:", err);
    showError(
      "Could not save inset map settings (storage may be full). Changes are kept in memory only."
    );
  }
}

// Field-by-field clamp/coerce, mirroring normalizeBottomFade's contract — a
// caller can pass a partial object (e.g. `{ enabled: true }` from a single
// change event) and get a complete, well-formed value back. Unknown keys are
// dropped. Exported so the UI/export tasks can normalize a live read into the
// exact same shape loadInset() returns.
//
// groupId is intentionally NOT validated against the live group store here
// (storage.js doesn't import it, and the stale-group contract says a
// now-deleted id is legal at any moment): a non-empty string is preserved
// verbatim, anything else becomes null. showLocator backfills to its default
// (true) only when the field is genuinely absent — an explicit `false` is
// preserved.
export function normalizeInset(value) {
  const v = value || {};
  const corner = INSET_CORNERS.includes(v.corner) ? v.corner : DEFAULT_INSET.corner;
  const sizeNum = Number(v.sizePct);
  const sizePct = Number.isFinite(sizeNum)
    ? Math.max(INSET_SIZE_MIN, Math.min(INSET_SIZE_MAX, Math.round(sizeNum)))
    : DEFAULT_INSET.sizePct;
  const groupId =
    typeof v.groupId === "string" && v.groupId ? v.groupId : null;
  return {
    enabled: Boolean(v.enabled),
    corner,
    sizePct,
    groupId,
    showLocator:
      v.showLocator === undefined
        ? DEFAULT_INSET.showLocator
        : Boolean(v.showLocator),
  };
}

// Global pin style — size of the pin icon plus the shared label typography
// (labelSize/labelColor/labelBold/labelFont). Own standalone key, same
// defensive load/clamp/save shape as loadBottomFade/saveBottomFade/
// normalizeBottomFade: missing key → defaults, corrupt key → defaults +
// banner, unknown/partial fields clamp or fall back field-by-field.
//
// Defaults below REPRODUCE js/map.js's current hardcoded rendering exactly,
// so a fresh user (or an existing user migrating onto this key for the
// first time) sees NO visual change until they touch the new controls:
//   - size: 32 — pin icon sprites are 128×128 source SVGs registered via
//     `addImage(..., { pixelRatio: 4 })` with the fill layer's
//     `icon-size: 1.0` (see the addImage calls in map.js), which displays
//     at 128 / 4 = 32 CSS px today.
//   - labelSize: 13 — map.js's exported `BASE_PIN_LABEL_SIZE`, the
//     pins-labels symbol layer's initial `text-size`.
//   - labelColor: "#1f2937" — the pins-labels layer's fixed `text-color`
//     paint value.
//   - labelBold: false — the layer's `text-font` is `["Noto Sans Regular"]`,
//     the non-bold glyph.
//   - labelFont: "" — empty string means "no override; use the default
//     stack". Pin labels render as a DOM overlay (js/map-labels.js), not a
//     MapLibre symbol layer, so — unlike the labels-layer-era restriction
//     this comment used to document — an arbitrary CSS font stack is safe:
//     there's no basemap glyph endpoint to 404 against.
//   - labelItalic: false — matches the label's default (non-italic) style,
//     same backfill contract as labelBold for pre-feature saves.
const PIN_STYLE_KEY = "city-pin-map.pin-style.v1";
const DEFAULT_PIN_STYLE = Object.freeze({
  size: 32,
  labelSize: 13,
  labelColor: "#1f2937",
  labelBold: false,
  labelFont: "",
  labelItalic: false,
});
const PIN_STYLE_SIZE_MIN = 8;
const PIN_STYLE_SIZE_MAX = 96;
const PIN_STYLE_LABEL_SIZE_MIN = 8;
const PIN_STYLE_LABEL_SIZE_MAX = 48;

export function loadPinStyle() {
  let raw;
  try {
    raw = localStorage.getItem(PIN_STYLE_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved pin style could not be read; using defaults.");
    return { ...DEFAULT_PIN_STYLE };
  }
  if (raw === null) return { ...DEFAULT_PIN_STYLE };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("saved pin style is not an object");
    }
    return normalizePinStyle(parsed);
  } catch (err) {
    console.error("saved pin style corrupt; ignoring:", err);
    showError("Saved pin style was corrupted and has been ignored.");
    return { ...DEFAULT_PIN_STYLE };
  }
}

export function savePinStyle(value) {
  try {
    localStorage.setItem(PIN_STYLE_KEY, JSON.stringify(normalizePinStyle(value)));
  } catch (err) {
    console.error("failed to save pin style:", err);
    showError(
      "Could not save pin style (storage may be full). Changes are kept in memory only."
    );
  }
}

// Field-by-field clamp/coerce, mirroring normalizeBottomFade's contract — a
// caller can pass a partial object (e.g. `{ labelBold: true }` from a
// single toggle event) and get a complete, well-formed value back. Unknown
// keys dropped. Exported so a consumer can normalize a live DOM read into
// the exact same shape loadPinStyle() returns (same FBL-013 rationale the
// other normalize* exports document).
export function normalizePinStyle(value) {
  const v = value || {};
  const sizeNum = Number(v.size);
  const size = Number.isFinite(sizeNum)
    ? Math.max(PIN_STYLE_SIZE_MIN, Math.min(PIN_STYLE_SIZE_MAX, Math.round(sizeNum)))
    : DEFAULT_PIN_STYLE.size;
  const labelSizeNum = Number(v.labelSize);
  const labelSize = Number.isFinite(labelSizeNum)
    ? Math.max(
        PIN_STYLE_LABEL_SIZE_MIN,
        Math.min(PIN_STYLE_LABEL_SIZE_MAX, Math.round(labelSizeNum))
      )
    : DEFAULT_PIN_STYLE.labelSize;
  const labelColor =
    typeof v.labelColor === "string" && HEX_COLOR_RE.test(v.labelColor)
      ? v.labelColor
      : DEFAULT_PIN_STYLE.labelColor;
  return {
    size,
    labelSize,
    labelColor,
    labelBold: Boolean(v.labelBold),
    labelFont: typeof v.labelFont === "string" ? v.labelFont : DEFAULT_PIN_STYLE.labelFont,
    labelItalic: Boolean(v.labelItalic),
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

// On-map title (PO-008/009, per-line model this milestone). Single-key
// object — see EMPTY_ON_MAP_TITLE above. Same defensive load shape as
// loadExportFrame: missing key → defaults, corrupt key → defaults + banner.
// nx/ny and every line individually validated through normalizeOnMapTitle /
// normalizeTitleLine so a partial / hand-edited object can never poison the
// export pipeline (e.g. non-finite nx/ny, an unknown font string, a bad
// color hex, a non-array `lines`).
//
// The three "give me an empty title" branches below call
// normalizeOnMapTitle(EMPTY_ON_MAP_TITLE) rather than spreading
// EMPTY_ON_MAP_TITLE directly — normalizeOnMapTitle always rebuilds `lines`
// via `.map()`, so every caller gets its own fresh array instead of a
// reference into the frozen singleton (mirrors why freshDefaultFrameSet()
// exists for the frame set below).
export function loadOnMapTitle() {
  let raw;
  try {
    raw = localStorage.getItem(ON_MAP_TITLE_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved on-map title could not be read; starting empty.");
    return normalizeOnMapTitle(EMPTY_ON_MAP_TITLE);
  }
  if (raw === null) return normalizeOnMapTitle(EMPTY_ON_MAP_TITLE);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("saved on-map title is not an object");
    }
    return normalizeOnMapTitle(parsed);
  } catch (err) {
    console.error("saved on-map title corrupt; ignoring:", err);
    showError("Saved on-map title was corrupted and has been ignored.");
    return normalizeOnMapTitle(EMPTY_ON_MAP_TITLE);
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

// A fresh, independently-mutable line for the title UI's "add line" button.
// bold:true/italic:false mirror the old single-title shape's defaults so a
// freshly-added line looks like PO-009's original title did.
export function defaultTitleLine() {
  return {
    text: "",
    font: DEFAULT_ON_MAP_TITLE_FONT,
    bold: true,
    italic: false,
    color: DEFAULT_ON_MAP_TITLE_COLOR,
    size: DEFAULT_ON_MAP_TITLE_SIZE,
  };
}

// Field-by-field clamp/coerce for ONE title line so callers can pass a
// partial object (e.g. `{ bold: true }` from a single toggle event) and get
// a complete well-formed line back. Unknown keys are dropped on the floor;
// an unknown font fontstack falls back to the default rather than silently
// rendering with whatever the browser maps it to. Exported so a consumer
// (e.g. the per-line editor UI) can normalize a single live-edited line
// without reimplementing these clamps, mirroring normalizeFrame's export
// rationale (FBL-013).
export function normalizeTitleLine(value) {
  const v = value || {};
  const sizeNum = Number(v.size);
  const size = Number.isFinite(sizeNum)
    ? Math.max(
        ON_MAP_TITLE_SIZE_MIN,
        Math.min(ON_MAP_TITLE_SIZE_MAX, Math.round(sizeNum))
      )
    : DEFAULT_ON_MAP_TITLE_SIZE;
  const color =
    typeof v.color === "string" && HEX_COLOR_RE.test(v.color)
      ? v.color
      : DEFAULT_ON_MAP_TITLE_COLOR;
  const font =
    typeof v.font === "string" && ON_MAP_TITLE_FONTS.includes(v.font)
      ? v.font
      : DEFAULT_ON_MAP_TITLE_FONT;
  return {
    text: typeof v.text === "string" ? v.text : "",
    font,
    bold: Boolean(v.bold),
    italic: Boolean(v.italic),
    color,
    size,
  };
}

// Field-by-field clamp/coerce for the whole title BLOCK: nx/ny plus the
// ordered `lines` array (each line run through normalizeTitleLine above).
// Unknown keys dropped on the floor.
//
// nx/ny are normalized frame-relative fractions (0..1) of the title BLOCK's
// CENTER against the map-container / export-crop dimensions — NOT map
// geography, so the title stays put across pan/zoom.
//
// Migration: a saved value from before the per-line model (PO-008/009) has
// no `lines` array — just top-level text/font/bold/italic/color/size
// siblings. A non-empty legacy `text` becomes exactly ONE line built from
// those siblings, preserving the user's existing title intact; a blank/
// absent legacy `text` (or any other non-array `lines`, including a value
// that's simply missing the field) degrades to `lines: []` rather than
// inventing a blank line. Exported (mirrors normalizeFrame/
// normalizeFrameSet/normalizeBottomFade) so a consumer can normalize a live
// DOM read into the exact same shape loadOnMapTitle() returns.
export function normalizeOnMapTitle(value) {
  const v = value || {};
  const nx = Number.isFinite(Number(v.nx))
    ? Math.min(1, Math.max(0, Number(v.nx)))
    : EMPTY_ON_MAP_TITLE.nx;
  const ny = Number.isFinite(Number(v.ny))
    ? Math.min(1, Math.max(0, Number(v.ny)))
    : EMPTY_ON_MAP_TITLE.ny;

  let rawLines = v.lines;
  if (!Array.isArray(rawLines)) {
    if (typeof v.text === "string" && v.text.length > 0) {
      // Legacy (pre-PO-008/009) titles stored multi-line text as a single
      // string with embedded "\n" breaks. Splitting on that here — rather
      // than wrapping the whole legacy string into one line object — means
      // the overlay (white-space:pre), the per-line <input> editor (which
      // can't hold a literal line break), and canvas fillText (which bakes
      // an embedded \n as tofu) all render the SAME multi-line title
      // instead of three inconsistent ones. Every segment shares the
      // legacy top-level font/bold/italic/color/size. A legacy text with no
      // \n still yields exactly one line; trailing empty segments (from a
      // trailing \n) are dropped, but intentional interior blank lines are
      // preserved.
      const segments = v.text.split(/\r?\n/);
      while (segments.length > 1 && segments[segments.length - 1] === "") {
        segments.pop();
      }
      rawLines = segments.map((segment) => ({
        text: segment,
        font: v.font,
        bold: v.bold,
        italic: v.italic,
        color: v.color,
        size: v.size,
      }));
    } else {
      rawLines = [];
    }
  }
  return { nx, ny, lines: rawLines.map(normalizeTitleLine) };
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
