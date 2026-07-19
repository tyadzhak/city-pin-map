// Run with: node --test js/storage.test.mjs
//
// Coverage target: ≥85% lines of js/storage.js. See tmp/COVERAGE-SPEC.md
// (test-writer G-A). Covers every normalizer, every load*/save* round trip
// (missing key / valid round trip / corrupt-value stash), the
// prewriteImportPayloads atomic pre-verify, the loadExportFrame legacy
// migration paths, and showError.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./test-helpers.mjs";
import { resetStorage } from "./test-helpers.mjs";
import { DEFAULT_PIN_COLOR } from "./pins.js";
import {
  loadPins,
  savePins,
  loadGroups,
  saveGroups,
  loadUserIcons,
  saveUserIcons,
  attachUserIconStorage,
  prewriteImportPayloads,
  loadMapStyle,
  saveMapStyle,
  loadRouteVisible,
  saveRouteVisible,
  loadExportFormat,
  saveExportFormat,
  loadActiveSideTab,
  saveActiveSideTab,
  loadExportFrame,
  saveExportFrame,
  normalizeFrame,
  normalizeFrameSet,
  normalizeFrameOutside,
  loadBottomFade,
  saveBottomFade,
  normalizeBottomFade,
  loadInset,
  saveInset,
  normalizeInset,
  loadPinStyle,
  savePinStyle,
  normalizePinStyle,
  loadHideLabels,
  saveHideLabels,
  loadOnMapTitle,
  saveOnMapTitle,
  defaultTitleLine,
  normalizeTitleLine,
  normalizeOnMapTitle,
  attachStorage,
  attachGroupStorage,
  showError,
  loadApiKey,
  saveApiKey,
  loadAllApiKeys,
  ON_MAP_TITLE_FONTS,
} from "./storage.js";

// ── literal key names (mirrors the private constants in storage.js, needed
// for precise byte-level assertions the public API alone can't express) ──
const PINS_KEY = "city-pin-map.pins.v1";
const GROUPS_KEY = "city-pin-map.groups.v1";
const USER_ICONS_KEY = "city-pin-map.user-icons.v1";
const MAP_STYLE_KEY = "city-pin-map.map-style.v1";
const EXPORT_FRAME_KEY = "city-pin-map.export-frame.v1";

beforeEach(() => {
  resetStorage();
  let banner = document.getElementById("error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "error-banner";
    document.body.appendChild(banner);
  }
  banner.textContent = "";
  banner.hidden = true;
});

// ── throwing-localStorage helpers ──────────────────────────────────────

function withThrowingGetItem(fn) {
  const original = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = () => {
    throw new Error("simulated getItem failure");
  };
  try {
    return fn();
  } finally {
    globalThis.localStorage.getItem = original;
  }
}

function withThrowingSetItem(fn) {
  const original = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error("simulated setItem failure");
  };
  try {
    return fn();
  } finally {
    globalThis.localStorage.setItem = original;
  }
}

function banner() {
  return document.getElementById("error-banner");
}

// ── loadPins / savePins / normalizeLoadedPins ─────────────────────────────

test("loadPins: missing key returns []", () => {
  assert.deepEqual(loadPins(), []);
});

test("loadPins/savePins: valid pin round-trips", () => {
  const pin = {
    id: "p1",
    name: "Kyiv, Ukraine",
    lat: 50.45,
    lon: 30.52,
    color: "#123456",
    group: "g1",
    icon: "circle",
    createdAt: 111,
    originalLat: 50.45,
    originalLon: 30.52,
    labelDx: 4,
    labelDy: -2,
  };
  savePins([pin]);
  const loaded = loadPins();
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], pin);
});

test("loadPins: fills in missing id/color/group/icon/createdAt", () => {
  globalThis.localStorage.setItem(
    PINS_KEY,
    JSON.stringify([{ name: "Somewhere", lat: 1, lon: 2 }])
  );
  const [pin] = loadPins();
  assert.equal(typeof pin.id, "string");
  assert.ok(pin.id.length > 0);
  assert.equal(pin.color, DEFAULT_PIN_COLOR);
  assert.equal(pin.group, null);
  assert.equal(pin.icon, null);
  assert.equal(typeof pin.createdAt, "number");
});

test("loadPins: drops null/non-object elements", () => {
  globalThis.localStorage.setItem(
    PINS_KEY,
    JSON.stringify([null, 42, "oops", { name: "Valid", lat: 1, lon: 1 }])
  );
  const loaded = loadPins();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "Valid");
  assert.match(banner().textContent, /Skipped 3 saved pins/);
});

test("loadPins: drops out-of-range or missing coordinates and blank name", () => {
  globalThis.localStorage.setItem(
    PINS_KEY,
    JSON.stringify([
      { name: "Bad lat", lat: 91, lon: 0 },
      { name: "Bad lat neg", lat: -91, lon: 0 },
      { name: "Bad lon", lat: 0, lon: 181 },
      { name: "Bad lon neg", lat: 0, lon: -181 },
      { name: "No coords", lat: "", lon: null },
      { name: "   ", lat: 1, lon: 1 },
      { lat: 1, lon: 1 },
      { name: "Fine", lat: 1, lon: 1 },
    ])
  );
  const loaded = loadPins();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "Fine");
  assert.match(banner().textContent, /Skipped 7 saved pins/);
});

test("loadPins: singular 'pin' phrasing when exactly one dropped", () => {
  globalThis.localStorage.setItem(PINS_KEY, JSON.stringify([null]));
  loadPins();
  assert.match(banner().textContent, /Skipped 1 saved pin that couldn't/);
});

test("loadPins: originalLat/originalLon carried only when both finite and in range", () => {
  globalThis.localStorage.setItem(
    PINS_KEY,
    JSON.stringify([
      { name: "Both valid", lat: 1, lon: 1, originalLat: 2, originalLon: 3 },
      { name: "One missing", lat: 1, lon: 1, originalLat: 2 },
      { name: "Out of range", lat: 1, lon: 1, originalLat: 999, originalLon: 3 },
    ])
  );
  const [both, oneMissing, outOfRange] = loadPins();
  assert.equal(both.originalLat, 2);
  assert.equal(both.originalLon, 3);
  assert.equal(oneMissing.originalLat, undefined);
  assert.equal(oneMissing.originalLon, undefined);
  assert.equal(outOfRange.originalLat, undefined);
});

test("loadPins: labelDx/labelDy carried only when finite, else omitted", () => {
  globalThis.localStorage.setItem(
    PINS_KEY,
    JSON.stringify([
      { name: "Has both", lat: 1, lon: 1, labelDx: 5, labelDy: 6 },
      { name: "Neither", lat: 1, lon: 1, labelDx: "nope", labelDy: null },
    ])
  );
  const [hasBoth, neither] = loadPins();
  assert.equal(hasBoth.labelDx, 5);
  assert.equal(hasBoth.labelDy, 6);
  assert.equal("labelDx" in neither, false);
  assert.equal("labelDy" in neither, false);
});

test("loadPins: corrupt (non-JSON) value falls back to [] and stashes original bytes", () => {
  globalThis.localStorage.setItem(PINS_KEY, "{not json");
  const loaded = loadPins();
  assert.deepEqual(loaded, []);
  assert.equal(globalThis.localStorage.getItem(`${PINS_KEY}.corrupt`), "{not json");
  assert.match(banner().textContent, /corrupted/);
  assert.match(banner().textContent, /\.corrupt/);
});

test("loadPins: valid JSON but wrong top-level shape is treated as corrupt", () => {
  globalThis.localStorage.setItem(PINS_KEY, JSON.stringify({ not: "an array" }));
  const loaded = loadPins();
  assert.deepEqual(loaded, []);
  assert.equal(
    globalThis.localStorage.getItem(`${PINS_KEY}.corrupt`),
    JSON.stringify({ not: "an array" })
  );
});

test("loadPins: getItem throw returns [] and shows a banner, no stash", () => {
  const loaded = withThrowingGetItem(() => loadPins());
  assert.deepEqual(loaded, []);
  assert.match(banner().textContent, /could not be read/);
});

test("loadPins: stash failure degrades banner message (no .corrupt mention)", () => {
  globalThis.localStorage.setItem(PINS_KEY, "{not json");
  withThrowingSetItem(() => loadPins());
  assert.match(banner().textContent, /corrupted/);
  assert.doesNotMatch(banner().textContent, /\.corrupt/);
});

test("savePins: setItem throw shows a banner and does not throw", () => {
  assert.doesNotThrow(() => withThrowingSetItem(() => savePins([])));
  assert.match(banner().textContent, /Could not save pins/);
});

// ── loadGroups / saveGroups / normalizeLoadedGroups ────────────────────────

test("loadGroups: missing key returns []", () => {
  assert.deepEqual(loadGroups(), []);
});

test("loadGroups/saveGroups: valid group round-trips", () => {
  const group = { id: "g1", name: "Trip", color: "#abcdef", createdAt: 5 };
  saveGroups([group]);
  assert.deepEqual(loadGroups(), [group]);
});

test("loadGroups: drops entries with blank/missing name; defaults id/color/createdAt", () => {
  globalThis.localStorage.setItem(
    GROUPS_KEY,
    JSON.stringify([
      null,
      { name: "  " },
      { color: "not-a-color" },
      { name: "Ok Group", color: "#zzzzzz" },
    ])
  );
  const loaded = loadGroups();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "Ok Group");
  assert.equal(loaded[0].color, "#e63946"); // invalid hex falls back to default
  assert.equal(typeof loaded[0].id, "string");
  assert.equal(typeof loaded[0].createdAt, "number");
  assert.match(banner().textContent, /Skipped 3 saved groups/);
});

test("loadGroups: valid 6-digit hex color is preserved", () => {
  globalThis.localStorage.setItem(
    GROUPS_KEY,
    JSON.stringify([{ name: "Ok", color: "#123ABC" }])
  );
  assert.equal(loadGroups()[0].color, "#123ABC");
});

test("loadGroups: corrupt value stashes and falls back to []", () => {
  globalThis.localStorage.setItem(GROUPS_KEY, "not json");
  const loaded = loadGroups();
  assert.deepEqual(loaded, []);
  assert.equal(globalThis.localStorage.getItem(`${GROUPS_KEY}.corrupt`), "not json");
});

test("loadGroups: getItem throw returns [] with a banner", () => {
  const loaded = withThrowingGetItem(() => loadGroups());
  assert.deepEqual(loaded, []);
  assert.match(banner().textContent, /could not be read/);
});

test("saveGroups: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveGroups([]));
  assert.match(banner().textContent, /Could not save groups/);
});

// ── loadUserIcons / saveUserIcons / normalizeLoadedUserIcons ───────────────

test("loadUserIcons: missing key returns []", () => {
  assert.deepEqual(loadUserIcons(), []);
});

test("loadUserIcons/saveUserIcons: valid icon round-trips with attribution", () => {
  const icon = {
    id: "i1",
    name: "Star",
    tintable: true,
    fillSvg: "<svg></svg>",
    attribution: { artistName: "Jane", sourceUrl: "https://example.com" },
    createdAt: 9,
  };
  saveUserIcons([icon]);
  assert.deepEqual(loadUserIcons(), [icon]);
});

test("loadUserIcons: drops entries without usable fillSvg", () => {
  globalThis.localStorage.setItem(
    USER_ICONS_KEY,
    JSON.stringify([null, { name: "No svg" }, { name: "Empty svg", fillSvg: "" }, { fillSvg: "<svg/>" }])
  );
  const loaded = loadUserIcons();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].fillSvg, "<svg/>");
  assert.equal(loaded[0].name, "");
  assert.equal(loaded[0].tintable, false);
  assert.equal(loaded[0].attribution, null);
  assert.match(banner().textContent, /Skipped 3 saved custom icons/);
});

test("loadUserIcons: attribution normalization — array/non-object → null, partial fields kept", () => {
  globalThis.localStorage.setItem(
    USER_ICONS_KEY,
    JSON.stringify([
      { fillSvg: "<a/>", attribution: ["x"] },
      { fillSvg: "<b/>", attribution: "nope" },
      { fillSvg: "<c/>", attribution: { artistName: "Only Name" } },
      { fillSvg: "<d/>", attribution: null },
    ])
  );
  const [a, b, c, d] = loadUserIcons();
  assert.equal(a.attribution, null);
  assert.equal(b.attribution, null);
  assert.deepEqual(c.attribution, { artistName: "Only Name", sourceUrl: null });
  assert.equal(d.attribution, null);
});

test("loadUserIcons: tintable coerced to boolean", () => {
  globalThis.localStorage.setItem(
    USER_ICONS_KEY,
    JSON.stringify([{ fillSvg: "<a/>", tintable: 1 }])
  );
  assert.equal(loadUserIcons()[0].tintable, true);
});

test("loadUserIcons: corrupt value stashes and falls back to []", () => {
  globalThis.localStorage.setItem(USER_ICONS_KEY, "{{{");
  assert.deepEqual(loadUserIcons(), []);
  assert.equal(globalThis.localStorage.getItem(`${USER_ICONS_KEY}.corrupt`), "{{{");
});

test("loadUserIcons: getItem throw returns [] with a banner", () => {
  const loaded = withThrowingGetItem(() => loadUserIcons());
  assert.deepEqual(loaded, []);
  assert.match(banner().textContent, /could not be read/);
});

test("saveUserIcons: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveUserIcons([]));
  assert.match(banner().textContent, /Could not save custom icons/);
});

test("attachUserIconStorage: hydrates store from storage and persists on change", () => {
  saveUserIcons([{ id: "i1", fillSvg: "<svg/>" }]);
  let saved = null;
  const store = {
    replaceAll(items) {
      this.items = items;
    },
    subscribe(fn) {
      saved = fn;
      return () => {};
    },
  };
  attachUserIconStorage(store);
  assert.equal(store.items.length, 1);
  saved([{ id: "i2", fillSvg: "<svg/>" }]);
  assert.equal(loadUserIcons().length, 1);
  assert.equal(loadUserIcons()[0].id, "i2");
});

// ── attachStorage / attachGroupStorage ──────────────────────────────────

test("attachStorage: hydrates pin store then persists subsequent changes", () => {
  savePins([{ id: "p1", name: "X", lat: 1, lon: 1, color: "#fff", group: null, icon: null, createdAt: 1 }]);
  let saved = null;
  const store = {
    replaceAll(items) {
      this.items = items;
    },
    subscribe(fn) {
      saved = fn;
      return () => {};
    },
  };
  attachStorage(store);
  assert.equal(store.items.length, 1);
  saved([]);
  assert.deepEqual(loadPins(), []);
});

test("attachGroupStorage: hydrates group store then persists subsequent changes", () => {
  saveGroups([{ id: "g1", name: "X", color: "#e63946", createdAt: 1 }]);
  let saved = null;
  const store = {
    replaceAll(items) {
      this.items = items;
    },
    subscribe(fn) {
      saved = fn;
      return () => {};
    },
  };
  attachGroupStorage(store);
  assert.equal(store.items.length, 1);
  saved([]);
  assert.deepEqual(loadGroups(), []);
});

// ── prewriteImportPayloads (FBL-016) ────────────────────────────────────

test("prewriteImportPayloads: valid payload without userIcons writes pins+groups only", () => {
  const ok = prewriteImportPayloads({ pins: [{ id: "p1" }], groups: [{ id: "g1" }], userIcons: null });
  assert.equal(ok, true);
  assert.equal(globalThis.localStorage.getItem(USER_ICONS_KEY), null);
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(PINS_KEY)), [{ id: "p1" }]);
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(GROUPS_KEY)), [{ id: "g1" }]);
});

test("prewriteImportPayloads: valid payload with userIcons writes all three keys", () => {
  const ok = prewriteImportPayloads({ pins: [], groups: [], userIcons: [{ id: "i1" }] });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(USER_ICONS_KEY)), [{ id: "i1" }]);
});

test("prewriteImportPayloads: mid-way failure rolls back every already-written key", () => {
  globalThis.localStorage.setItem(PINS_KEY, JSON.stringify([{ id: "original-pin" }]));
  // GROUPS_KEY intentionally left unset (previous === null) for this run.

  let calls = 0;
  const originalSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = function (key, value) {
    calls++;
    if (calls === 2) throw new Error("quota exceeded on 2nd write");
    return originalSetItem.call(this, key, value);
  };
  let ok;
  try {
    ok = prewriteImportPayloads({
      pins: [{ id: "new-pin" }],
      groups: [{ id: "new-group" }],
      userIcons: null,
    });
  } finally {
    globalThis.localStorage.setItem = originalSetItem;
  }

  assert.equal(ok, false);
  // pins write succeeded then got rolled back to its pre-attempt bytes.
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(PINS_KEY)), [{ id: "original-pin" }]);
  // groups was never successfully written (threw before push), so it was
  // never in writtenKeys and stays at its pre-attempt state: unset.
  assert.equal(globalThis.localStorage.getItem(GROUPS_KEY), null);
});

test("prewriteImportPayloads: failure on the very first write needs no rollback and still returns false", () => {
  const originalSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error("fails immediately");
  };
  let ok;
  try {
    ok = prewriteImportPayloads({ pins: [{ id: "x" }], groups: [], userIcons: null });
  } finally {
    globalThis.localStorage.setItem = originalSetItem;
  }
  assert.equal(ok, false);
  assert.equal(globalThis.localStorage.getItem(PINS_KEY), null);
});

// ── loadMapStyle / saveMapStyle ─────────────────────────────────────────

test("loadMapStyle: missing key returns null", () => {
  assert.equal(loadMapStyle(), null);
});

test("loadMapStyle/saveMapStyle: bare-string round trip", () => {
  saveMapStyle("carto-light");
  assert.equal(loadMapStyle(), "carto-light");
  assert.equal(globalThis.localStorage.getItem(MAP_STYLE_KEY), "carto-light");
});

test("loadMapStyle: getItem throw returns null with a banner", () => {
  const value = withThrowingGetItem(() => loadMapStyle());
  assert.equal(value, null);
  assert.match(banner().textContent, /could not be read/);
});

test("saveMapStyle: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveMapStyle("x"));
  assert.match(banner().textContent, /Could not save map style/);
});

// ── loadRouteVisible / saveRouteVisible ─────────────────────────────────

test("loadRouteVisible: missing key defaults to false", () => {
  assert.equal(loadRouteVisible(), false);
});

test("loadRouteVisible/saveRouteVisible: round trip true and false", () => {
  saveRouteVisible(true);
  assert.equal(loadRouteVisible(), true);
  saveRouteVisible(false);
  assert.equal(loadRouteVisible(), false);
});

test("loadRouteVisible: any non-'true' stored value is false", () => {
  globalThis.localStorage.setItem("city-pin-map.route-visible.v1", "TRUE");
  assert.equal(loadRouteVisible(), false);
});

test("loadRouteVisible: getItem throw returns false without throwing", () => {
  assert.equal(withThrowingGetItem(() => loadRouteVisible()), false);
});

test("saveRouteVisible: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveRouteVisible(true));
  assert.match(banner().textContent, /Could not save route/);
});

// ── loadExportFormat / saveExportFormat ─────────────────────────────────

test("loadExportFormat: missing key defaults to 'current'", () => {
  assert.equal(loadExportFormat(), "current");
});

test("loadExportFormat/saveExportFormat: round trip", () => {
  saveExportFormat("a4-portrait");
  assert.equal(loadExportFormat(), "a4-portrait");
});

test("loadExportFormat: getItem throw returns default with a banner", () => {
  const value = withThrowingGetItem(() => loadExportFormat());
  assert.equal(value, "current");
  assert.match(banner().textContent, /could not be read/);
});

test("saveExportFormat: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveExportFormat("current"));
  assert.match(banner().textContent, /Could not save export format/);
});

// ── loadActiveSideTab / saveActiveSideTab ───────────────────────────────

test("loadActiveSideTab: missing key defaults to 'design'", () => {
  assert.equal(loadActiveSideTab(), "design");
});

test("loadActiveSideTab/saveActiveSideTab: round trip every valid id", () => {
  for (const id of ["design", "pins", "groups"]) {
    saveActiveSideTab(id);
    assert.equal(loadActiveSideTab(), id);
  }
});

test("loadActiveSideTab: unknown saved value falls back to default", () => {
  globalThis.localStorage.setItem("city-pin-map.side-tab.v1", "bogus");
  assert.equal(loadActiveSideTab(), "design");
});

test("saveActiveSideTab: rejects an invalid id without writing", () => {
  saveActiveSideTab("bogus");
  assert.equal(loadActiveSideTab(), "design");
  assert.equal(globalThis.localStorage.getItem("city-pin-map.side-tab.v1"), null);
});

test("loadActiveSideTab: getItem throw returns default", () => {
  assert.equal(withThrowingGetItem(() => loadActiveSideTab()), "design");
});

test("saveActiveSideTab: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveActiveSideTab("pins"));
  assert.match(banner().textContent, /Could not save side panel tab/);
});

// ── normalizeFrame ───────────────────────────────────────────────────────

test("normalizeFrame: defaults for empty/undefined input", () => {
  assert.deepEqual(normalizeFrame(undefined), {
    enabled: false,
    thickness: 60,
    color: "#ffffff",
    shadow: false,
    padding: 0,
    margin: 0,
    radius: 0,
  });
});

test("normalizeFrame: clamps thickness/padding/margin/radius to [0,200] and rounds", () => {
  const result = normalizeFrame({ thickness: 500, padding: -5, margin: 12.6, radius: -1 });
  assert.equal(result.thickness, 200);
  assert.equal(result.padding, 0);
  assert.equal(result.margin, 13);
  assert.equal(result.radius, 0);
});

test("normalizeFrame: non-finite numeric fields fall back to defaults", () => {
  const result = normalizeFrame({ thickness: "abc", padding: NaN, margin: undefined, radius: null });
  assert.equal(result.thickness, 60);
  assert.equal(result.padding, 0);
  assert.equal(result.margin, 0);
  assert.equal(result.radius, 0);
});

test("normalizeFrame: rejects invalid hex color, accepts valid", () => {
  assert.equal(normalizeFrame({ color: "red" }).color, "#ffffff");
  assert.equal(normalizeFrame({ color: "#00FF00" }).color, "#00FF00");
});

test("normalizeFrame: boolean coercion for enabled/shadow", () => {
  assert.equal(normalizeFrame({ enabled: 1, shadow: 0 }).enabled, true);
  assert.equal(normalizeFrame({ enabled: 1, shadow: 0 }).shadow, false);
});

// ── normalizeFrameOutside ────────────────────────────────────────────────

test("normalizeFrameOutside: defaults for empty input", () => {
  assert.deepEqual(normalizeFrameOutside(undefined), { mode: "none", color: "#ffffff", blur: 8 });
});

test("normalizeFrameOutside: valid modes accepted, invalid falls back", () => {
  assert.equal(normalizeFrameOutside({ mode: "white" }).mode, "white");
  assert.equal(normalizeFrameOutside({ mode: "blur" }).mode, "blur");
  assert.equal(normalizeFrameOutside({ mode: "bogus" }).mode, "none");
});

test("normalizeFrameOutside: clamps blur and validates color", () => {
  assert.equal(normalizeFrameOutside({ blur: 999 }).blur, 50);
  assert.equal(normalizeFrameOutside({ blur: -5 }).blur, 0);
  assert.equal(normalizeFrameOutside({ color: "nope" }).color, "#ffffff");
  assert.equal(normalizeFrameOutside({ color: "#010203" }).color, "#010203");
});

// ── normalizeFrameSet / loadExportFrame / saveExportFrame ──────────────

test("normalizeFrameSet: fills in both frame slots and outside from partial input", () => {
  const set = normalizeFrameSet({ frames: [{ enabled: true, thickness: 10 }] });
  assert.equal(set.frames.length, 2);
  assert.equal(set.frames[0].enabled, true);
  assert.equal(set.frames[0].thickness, 10);
  // slot 1 missing entirely -> Frame 2 default
  assert.equal(set.frames[1].thickness, 4);
  assert.equal(set.frames[1].margin, 16);
  assert.deepEqual(set.outside, { mode: "none", color: "#ffffff", blur: 8 });
});

test("normalizeFrameSet: non-array frames falls back to both defaults", () => {
  const set = normalizeFrameSet({ frames: "nope" });
  assert.equal(set.frames[0].thickness, 60);
  assert.equal(set.frames[1].thickness, 4);
});

test("normalizeFrameSet: extra elements beyond index 1 are dropped", () => {
  const set = normalizeFrameSet({
    frames: [{ thickness: 1 }, { thickness: 2 }, { thickness: 3 }],
  });
  assert.equal(set.frames.length, 2);
  assert.equal(set.frames[1].thickness, 2);
});

test("loadExportFrame: missing key returns fresh default frame set", () => {
  const set = loadExportFrame();
  assert.equal(set.frames.length, 2);
  assert.equal(set.frames[0].enabled, false);
  assert.equal(set.frames[1].margin, 16);
  assert.equal(set.outside.mode, "none");
});

test("loadExportFrame/saveExportFrame: frame-set shape round trips", () => {
  const value = {
    frames: [
      { enabled: true, thickness: 20, color: "#111111", shadow: true, padding: 1, margin: 2, radius: 3 },
      { enabled: false, thickness: 4, color: "#000000", shadow: false, padding: 0, margin: 16, radius: 0 },
    ],
    outside: { mode: "white", color: "#eeeeee", blur: 12 },
  };
  saveExportFrame(value);
  assert.deepEqual(loadExportFrame(), value);
});

test("loadExportFrame: legacy bare single-frame value migrates into Frame 1, seeds Frame 2 + outside defaults", () => {
  globalThis.localStorage.setItem(
    EXPORT_FRAME_KEY,
    JSON.stringify({ enabled: true, thickness: 33, color: "#ababab" })
  );
  const set = loadExportFrame();
  assert.equal(set.frames[0].enabled, true);
  assert.equal(set.frames[0].thickness, 33);
  assert.equal(set.frames[0].color, "#ababab");
  assert.deepEqual(set.frames[1], {
    enabled: false,
    thickness: 4,
    color: "#000000",
    shadow: false,
    padding: 0,
    margin: 16,
    radius: 0,
  });
  assert.deepEqual(set.outside, { mode: "none", color: "#ffffff", blur: 8 });
});

test("loadExportFrame: {frames:[...]} without outside backfills a valid default outside", () => {
  globalThis.localStorage.setItem(
    EXPORT_FRAME_KEY,
    JSON.stringify({ frames: [{ enabled: true }, { enabled: true }] })
  );
  const set = loadExportFrame();
  assert.deepEqual(set.outside, { mode: "none", color: "#ffffff", blur: 8 });
});

test("loadExportFrame: unrecognizable object (no frames, no legacy fields) falls back to defaults + banner", () => {
  globalThis.localStorage.setItem(EXPORT_FRAME_KEY, JSON.stringify({ totally: "unrelated" }));
  const set = loadExportFrame();
  assert.equal(set.frames[0].thickness, 60);
  assert.match(banner().textContent, /corrupted/);
});

test("loadExportFrame: non-object JSON (e.g. a number) is treated as corrupt", () => {
  globalThis.localStorage.setItem(EXPORT_FRAME_KEY, "42");
  const set = loadExportFrame();
  assert.equal(set.frames[0].thickness, 60);
  assert.match(banner().textContent, /corrupted/);
});

test("loadExportFrame: non-JSON value is treated as corrupt", () => {
  globalThis.localStorage.setItem(EXPORT_FRAME_KEY, "{bad");
  const set = loadExportFrame();
  assert.equal(set.frames[0].thickness, 60);
});

test("loadExportFrame: getItem throw returns fresh defaults with a banner", () => {
  const set = withThrowingGetItem(() => loadExportFrame());
  assert.equal(set.frames[0].thickness, 60);
  assert.match(banner().textContent, /could not be read/);
});

test("saveExportFrame: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveExportFrame({}));
  assert.match(banner().textContent, /Could not save frame settings/);
});

// ── normalizeBottomFade / loadBottomFade / saveBottomFade ───────────────

test("normalizeBottomFade: defaults for empty input", () => {
  assert.deepEqual(normalizeBottomFade(undefined), {
    enabled: false,
    height: 30,
    color: "#ffffff",
    intensity: 50,
  });
});

test("normalizeBottomFade: clamps height and intensity to [0,100]", () => {
  assert.equal(normalizeBottomFade({ height: 500 }).height, 100);
  assert.equal(normalizeBottomFade({ height: -5 }).height, 0);
  assert.equal(normalizeBottomFade({ intensity: 500 }).intensity, 100);
  assert.equal(normalizeBottomFade({ intensity: -5 }).intensity, 0);
});

test("normalizeBottomFade: invalid color falls back, valid preserved", () => {
  assert.equal(normalizeBottomFade({ color: "nope" }).color, "#ffffff");
  assert.equal(normalizeBottomFade({ color: "#010203" }).color, "#010203");
});

test("normalizeBottomFade: boolean coercion for enabled", () => {
  assert.equal(normalizeBottomFade({ enabled: "yes" }).enabled, true);
});

test("loadBottomFade: missing key returns defaults", () => {
  assert.deepEqual(loadBottomFade(), { enabled: false, height: 30, color: "#ffffff", intensity: 50 });
});

test("loadBottomFade/saveBottomFade: round trip and backfills intensity for legacy saved fades", () => {
  saveBottomFade({ enabled: true, height: 40, color: "#abcdef", intensity: 70 });
  assert.deepEqual(loadBottomFade(), { enabled: true, height: 40, color: "#abcdef", intensity: 70 });

  // A fade saved before `intensity` existed (pre-field) backfills to 50.
  globalThis.localStorage.setItem(
    "city-pin-map.bottom-fade.v1",
    JSON.stringify({ enabled: true, height: 20, color: "#ffffff" })
  );
  assert.equal(loadBottomFade().intensity, 50);
});

test("loadBottomFade: corrupt/non-object value falls back to defaults + banner", () => {
  globalThis.localStorage.setItem("city-pin-map.bottom-fade.v1", "42");
  assert.deepEqual(loadBottomFade(), { enabled: false, height: 30, color: "#ffffff", intensity: 50 });
  assert.match(banner().textContent, /corrupted/);

  globalThis.localStorage.setItem("city-pin-map.bottom-fade.v1", "{not json");
  assert.deepEqual(loadBottomFade(), { enabled: false, height: 30, color: "#ffffff", intensity: 50 });
});

test("loadBottomFade: getItem throw returns defaults with a banner", () => {
  const fade = withThrowingGetItem(() => loadBottomFade());
  assert.equal(fade.height, 30);
  assert.match(banner().textContent, /could not be read/);
});

test("saveBottomFade: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveBottomFade({}));
  assert.match(banner().textContent, /Could not save bottom fade/);
});

// ── normalizeInset / loadInset / saveInset ──────────────────────────────

test("normalizeInset: defaults for empty input", () => {
  assert.deepEqual(normalizeInset(undefined), {
    enabled: false,
    corner: "top-right",
    sizePct: 32,
    groupId: null,
    showLocator: true,
    freePos: null,
  });
});

test("normalizeInset: invalid corner falls back, valid preserved", () => {
  assert.equal(normalizeInset({ corner: "middle" }).corner, "top-right");
  assert.equal(normalizeInset({ corner: "bottom-left" }).corner, "bottom-left");
});

test("normalizeInset: clamps sizePct to [15,50] and rounds", () => {
  assert.equal(normalizeInset({ sizePct: 500 }).sizePct, 50);
  assert.equal(normalizeInset({ sizePct: 2 }).sizePct, 15);
  assert.equal(normalizeInset({ sizePct: 33.7 }).sizePct, 34);
  // Non-finite → default.
  assert.equal(normalizeInset({ sizePct: "nope" }).sizePct, 32);
});

test("normalizeInset: groupId keeps non-empty string, else null", () => {
  assert.equal(normalizeInset({ groupId: "abc" }).groupId, "abc");
  assert.equal(normalizeInset({ groupId: "" }).groupId, null);
  assert.equal(normalizeInset({ groupId: 42 }).groupId, null);
  assert.equal(normalizeInset({ groupId: null }).groupId, null);
});

test("normalizeInset: showLocator backfills to true when absent, else coerces", () => {
  assert.equal(normalizeInset({}).showLocator, true);
  assert.equal(normalizeInset({ showLocator: false }).showLocator, false);
  assert.equal(normalizeInset({ showLocator: "yes" }).showLocator, true);
});

test("normalizeInset: boolean coercion for enabled", () => {
  assert.equal(normalizeInset({ enabled: "yes" }).enabled, true);
  assert.equal(normalizeInset({}).enabled, false);
});

test("normalizeInset: freePos backfills to null when absent", () => {
  assert.equal(normalizeInset({}).freePos, null);
  assert.equal(normalizeInset({ enabled: true }).freePos, null);
});

test("normalizeInset: freePos keeps valid fractions, clamps to [0,1]", () => {
  assert.deepEqual(normalizeInset({ freePos: { nx: 0.25, ny: 0.75 } }).freePos, {
    nx: 0.25,
    ny: 0.75,
  });
  // Out-of-range values clamp per-axis rather than nulling the whole thing.
  assert.deepEqual(normalizeInset({ freePos: { nx: 1.4, ny: -0.3 } }).freePos, {
    nx: 1,
    ny: 0,
  });
});

test("normalizeInset: malformed freePos coerces to null", () => {
  assert.equal(normalizeInset({ freePos: null }).freePos, null);
  assert.equal(normalizeInset({ freePos: 42 }).freePos, null);
  assert.equal(normalizeInset({ freePos: "nope" }).freePos, null);
  assert.equal(normalizeInset({ freePos: {} }).freePos, null);
  assert.equal(normalizeInset({ freePos: { nx: 0.5 } }).freePos, null);
  assert.equal(normalizeInset({ freePos: { nx: "a", ny: "b" } }).freePos, null);
  assert.equal(normalizeInset({ freePos: { nx: NaN, ny: 0.5 } }).freePos, null);
});

test("loadInset: missing key returns defaults", () => {
  assert.deepEqual(loadInset(), {
    enabled: false,
    corner: "top-right",
    sizePct: 32,
    groupId: null,
    showLocator: true,
    freePos: null,
  });
});

test("loadInset/saveInset: round trip", () => {
  saveInset({
    enabled: true,
    corner: "bottom-right",
    sizePct: 40,
    groupId: "grp-1",
    showLocator: false,
  });
  assert.deepEqual(loadInset(), {
    enabled: true,
    corner: "bottom-right",
    sizePct: 40,
    groupId: "grp-1",
    showLocator: false,
    freePos: null,
  });
});

test("loadInset/saveInset: round trip preserves freePos", () => {
  saveInset({
    enabled: true,
    corner: "top-left",
    sizePct: 30,
    groupId: "grp-2",
    showLocator: true,
    freePos: { nx: 0.4, ny: 0.6 },
  });
  assert.deepEqual(loadInset().freePos, { nx: 0.4, ny: 0.6 });
});

test("loadInset: legacy saved value without showLocator backfills to true", () => {
  globalThis.localStorage.setItem(
    "city-pin-map.inset.v1",
    JSON.stringify({ enabled: true, corner: "top-left", sizePct: 20, groupId: null })
  );
  assert.equal(loadInset().showLocator, true);
});

test("loadInset: corrupt/non-object value falls back to defaults + banner", () => {
  globalThis.localStorage.setItem("city-pin-map.inset.v1", "42");
  assert.deepEqual(loadInset(), {
    enabled: false,
    corner: "top-right",
    sizePct: 32,
    groupId: null,
    showLocator: true,
    freePos: null,
  });
  assert.match(banner().textContent, /corrupted/);

  globalThis.localStorage.setItem("city-pin-map.inset.v1", "{not json");
  assert.deepEqual(loadInset(), {
    enabled: false,
    corner: "top-right",
    sizePct: 32,
    groupId: null,
    showLocator: true,
    freePos: null,
  });
});

test("loadInset: getItem throw returns defaults with a banner", () => {
  const inset = withThrowingGetItem(() => loadInset());
  assert.equal(inset.sizePct, 32);
  assert.match(banner().textContent, /could not be read/);
});

test("saveInset: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveInset({}));
  assert.match(banner().textContent, /Could not save inset map/);
});

// ── normalizePinStyle / loadPinStyle / savePinStyle ─────────────────────

test("normalizePinStyle: defaults for empty input", () => {
  assert.deepEqual(normalizePinStyle(undefined), {
    size: 32,
    labelSize: 13,
    labelColor: "#1f2937",
    labelBold: false,
    labelFont: "",
    labelItalic: false,
  });
});

test("normalizePinStyle: clamps size to [8,96] and labelSize to [8,48]", () => {
  assert.equal(normalizePinStyle({ size: 1000 }).size, 96);
  assert.equal(normalizePinStyle({ size: 1 }).size, 8);
  assert.equal(normalizePinStyle({ labelSize: 1000 }).labelSize, 48);
  assert.equal(normalizePinStyle({ labelSize: 1 }).labelSize, 8);
});

test("normalizePinStyle: invalid labelColor falls back, valid preserved", () => {
  assert.equal(normalizePinStyle({ labelColor: "nope" }).labelColor, "#1f2937");
  assert.equal(normalizePinStyle({ labelColor: "#222222" }).labelColor, "#222222");
});

test("normalizePinStyle: labelFont passes through any string, non-string falls back", () => {
  assert.equal(normalizePinStyle({ labelFont: "Arial" }).labelFont, "Arial");
  assert.equal(normalizePinStyle({ labelFont: 5 }).labelFont, "");
});

test("normalizePinStyle: labelBold boolean coercion", () => {
  assert.equal(normalizePinStyle({ labelBold: 1 }).labelBold, true);
});

test("normalizePinStyle: labelItalic boolean coercion, backfills false when absent", () => {
  assert.equal(normalizePinStyle({ labelItalic: 1 }).labelItalic, true);
  assert.equal(normalizePinStyle({ labelItalic: 0 }).labelItalic, false);
  assert.equal(normalizePinStyle({}).labelItalic, false);
});

test("loadPinStyle: missing key returns defaults", () => {
  assert.deepEqual(loadPinStyle(), {
    size: 32,
    labelSize: 13,
    labelColor: "#1f2937",
    labelBold: false,
    labelFont: "",
    labelItalic: false,
  });
});

test("loadPinStyle/savePinStyle: round trip", () => {
  const style = {
    size: 40,
    labelSize: 20,
    labelColor: "#00ff00",
    labelBold: true,
    labelFont: "Arial",
    labelItalic: true,
  };
  savePinStyle(style);
  assert.deepEqual(loadPinStyle(), style);
});

test("loadPinStyle: pre-feature saved value (no labelItalic) backfills to false", () => {
  globalThis.localStorage.setItem(
    "city-pin-map.pin-style.v1",
    JSON.stringify({ size: 40, labelSize: 20, labelColor: "#00ff00", labelBold: true, labelFont: "Arial" })
  );
  assert.equal(loadPinStyle().labelItalic, false);
});

test("loadPinStyle: corrupt value falls back to defaults + banner", () => {
  globalThis.localStorage.setItem("city-pin-map.pin-style.v1", "nope{{");
  assert.deepEqual(loadPinStyle(), {
    size: 32,
    labelSize: 13,
    labelColor: "#1f2937",
    labelBold: false,
    labelFont: "",
    labelItalic: false,
  });
  assert.match(banner().textContent, /corrupted/);
});

test("loadPinStyle: non-object JSON value is treated as corrupt", () => {
  globalThis.localStorage.setItem("city-pin-map.pin-style.v1", "true");
  assert.equal(loadPinStyle().size, 32);
});

test("loadPinStyle: getItem throw returns defaults with a banner", () => {
  const style = withThrowingGetItem(() => loadPinStyle());
  assert.equal(style.size, 32);
  assert.match(banner().textContent, /could not be read/);
});

test("savePinStyle: setItem throw shows a banner", () => {
  withThrowingSetItem(() => savePinStyle({}));
  assert.match(banner().textContent, /Could not save pin style/);
});

// ── loadHideLabels / saveHideLabels ─────────────────────────────────────

test("loadHideLabels: missing key defaults to false", () => {
  assert.equal(loadHideLabels(), false);
});

test("loadHideLabels/saveHideLabels: round trip true and false", () => {
  saveHideLabels(true);
  assert.equal(loadHideLabels(), true);
  saveHideLabels(false);
  assert.equal(loadHideLabels(), false);
});

test("loadHideLabels: getItem throw returns false", () => {
  assert.equal(withThrowingGetItem(() => loadHideLabels()), false);
});

test("saveHideLabels: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveHideLabels(true));
  assert.match(banner().textContent, /Could not save hide-labels/);
});

// ── defaultTitleLine / normalizeTitleLine ───────────────────────────────

test("defaultTitleLine: matches the PO-009 legacy-shape defaults", () => {
  assert.deepEqual(defaultTitleLine(), {
    text: "",
    font: ON_MAP_TITLE_FONTS[0],
    bold: true,
    italic: false,
    color: "#1f2937",
    size: 20,
  });
});

test("normalizeTitleLine: defaults for empty input", () => {
  assert.deepEqual(normalizeTitleLine(undefined), {
    text: "",
    font: ON_MAP_TITLE_FONTS[0],
    bold: false,
    italic: false,
    color: "#1f2937",
    size: 20,
  });
});

test("normalizeTitleLine: clamps size to [10,80]", () => {
  assert.equal(normalizeTitleLine({ size: 1000 }).size, 80);
  assert.equal(normalizeTitleLine({ size: 1 }).size, 10);
});

test("normalizeTitleLine: unknown font falls back to default, known font preserved", () => {
  assert.equal(normalizeTitleLine({ font: "Comic Sans" }).font, ON_MAP_TITLE_FONTS[0]);
  assert.equal(normalizeTitleLine({ font: ON_MAP_TITLE_FONTS[2] }).font, ON_MAP_TITLE_FONTS[2]);
});

test("normalizeTitleLine: invalid color falls back, valid preserved", () => {
  assert.equal(normalizeTitleLine({ color: "nope" }).color, "#1f2937");
  assert.equal(normalizeTitleLine({ color: "#334455" }).color, "#334455");
});

test("normalizeTitleLine: text non-string falls back to '', bold/italic boolean coercion", () => {
  assert.equal(normalizeTitleLine({ text: 5 }).text, "");
  assert.equal(normalizeTitleLine({ text: "hi" }).text, "hi");
  assert.equal(normalizeTitleLine({ bold: 1, italic: 0 }).bold, true);
  assert.equal(normalizeTitleLine({ bold: 1, italic: 0 }).italic, false);
});

// ── normalizeOnMapTitle / loadOnMapTitle / saveOnMapTitle ───────────────

test("normalizeOnMapTitle: defaults for empty input", () => {
  assert.deepEqual(normalizeOnMapTitle(undefined), { nx: 0.5, ny: 0.85, lines: [] });
});

test("normalizeOnMapTitle: nx/ny clamp to [0,1], invalid falls back to 0.5/0.85", () => {
  assert.equal(normalizeOnMapTitle({ nx: 5, ny: -5 }).nx, 1);
  assert.equal(normalizeOnMapTitle({ nx: 5, ny: -5 }).ny, 0);
  assert.equal(normalizeOnMapTitle({ nx: "x", ny: undefined }).nx, 0.5);
  assert.equal(normalizeOnMapTitle({ nx: "x", ny: undefined }).ny, 0.85);
});

test("normalizeOnMapTitle: array lines are normalized per-line", () => {
  const result = normalizeOnMapTitle({
    nx: 0.2,
    ny: 0.3,
    lines: [{ text: "Hello", size: 30 }, { text: "World" }],
  });
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].text, "Hello");
  assert.equal(result.lines[0].size, 30);
  assert.equal(result.lines[1].text, "World");
});

test("normalizeOnMapTitle: legacy single-string text migrates into one line per \\n-split segment", () => {
  const result = normalizeOnMapTitle({
    text: "Line one\nLine two\r\nLine three",
    font: ON_MAP_TITLE_FONTS[1],
    bold: true,
    italic: true,
    color: "#010101",
    size: 40,
  });
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0].text, "Line one");
  assert.equal(result.lines[1].text, "Line two");
  assert.equal(result.lines[2].text, "Line three");
  for (const line of result.lines) {
    assert.equal(line.font, ON_MAP_TITLE_FONTS[1]);
    assert.equal(line.bold, true);
    assert.equal(line.italic, true);
    assert.equal(line.color, "#010101");
    assert.equal(line.size, 40);
  }
});

test("normalizeOnMapTitle: legacy migration strips a single trailing blank segment but keeps interior blank lines", () => {
  const trailing = normalizeOnMapTitle({ text: "A\nB\n" });
  assert.deepEqual(trailing.lines.map((l) => l.text), ["A", "B"]);

  const interior = normalizeOnMapTitle({ text: "A\n\nB" });
  assert.deepEqual(interior.lines.map((l) => l.text), ["A", "", "B"]);
});

test("normalizeOnMapTitle: legacy text with no newline yields exactly one line", () => {
  const result = normalizeOnMapTitle({ text: "Solo line" });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].text, "Solo line");
});

test("normalizeOnMapTitle: blank/absent legacy text and non-array lines degrade to empty lines array", () => {
  assert.deepEqual(normalizeOnMapTitle({ text: "" }).lines, []);
  assert.deepEqual(normalizeOnMapTitle({ lines: "nope" }).lines, []);
  assert.deepEqual(normalizeOnMapTitle({}).lines, []);
});

test("loadOnMapTitle: missing key returns empty-title defaults", () => {
  assert.deepEqual(loadOnMapTitle(), { nx: 0.5, ny: 0.85, lines: [] });
});

test("loadOnMapTitle/saveOnMapTitle: round trip a multi-line title", () => {
  const value = {
    nx: 0.4,
    ny: 0.6,
    lines: [defaultTitleLine(), { ...defaultTitleLine(), text: "Second" }],
  };
  saveOnMapTitle(value);
  const loaded = loadOnMapTitle();
  assert.equal(loaded.nx, 0.4);
  assert.equal(loaded.ny, 0.6);
  assert.equal(loaded.lines.length, 2);
  assert.equal(loaded.lines[1].text, "Second");
});

test("loadOnMapTitle: corrupt/non-object value falls back to empty defaults + banner", () => {
  globalThis.localStorage.setItem("city-pin-map.export-on-map-title.v1", "{bad");
  assert.deepEqual(loadOnMapTitle(), { nx: 0.5, ny: 0.85, lines: [] });
  assert.match(banner().textContent, /corrupted/);

  globalThis.localStorage.setItem("city-pin-map.export-on-map-title.v1", "42");
  assert.deepEqual(loadOnMapTitle(), { nx: 0.5, ny: 0.85, lines: [] });
});

test("loadOnMapTitle: getItem throw returns empty defaults with a banner", () => {
  const title = withThrowingGetItem(() => loadOnMapTitle());
  assert.deepEqual(title, { nx: 0.5, ny: 0.85, lines: [] });
  assert.match(banner().textContent, /starting empty/);
});

test("saveOnMapTitle: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveOnMapTitle({}));
  assert.match(banner().textContent, /Could not save on-map title/);
});

// ── showError ────────────────────────────────────────────────────────────

test("showError: writes the message and unhides the banner, re-hides after timeout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showError("hello world");
  const el = banner();
  assert.equal(el.textContent, "hello world");
  assert.equal(el.hidden, false);
  t.mock.timers.tick(6000);
  assert.equal(el.hidden, true);
});

test("showError: replacing an in-flight timer with a new call doesn't throw", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showError("first");
  showError("second");
  assert.equal(banner().textContent, "second");
  t.mock.timers.tick(6000);
  assert.equal(banner().hidden, true);
});

test("showError: missing banner element does not throw", () => {
  const el = banner();
  const previousId = el.id;
  el.id = ""; // unregister from the id map so getElementById("error-banner") misses
  try {
    assert.doesNotThrow(() => showError("no banner here"));
  } finally {
    el.id = previousId; // re-register for later tests
  }
});

// ── loadApiKey / saveApiKey / loadAllApiKeys ────────────────────────────

test("loadApiKey: unknown provider returns '' and saveApiKey is a no-op", () => {
  assert.equal(loadApiKey("bogus"), "");
  assert.doesNotThrow(() => saveApiKey("bogus", "secret"));
  assert.equal(loadApiKey("bogus"), "");
});

test("loadApiKey/saveApiKey: round trip for every known provider", () => {
  for (const provider of ["stadia", "maptiler", "thunderforest"]) {
    assert.equal(loadApiKey(provider), "");
    saveApiKey(provider, `${provider}-secret`);
    assert.equal(loadApiKey(provider), `${provider}-secret`);
  }
});

test("saveApiKey: empty value removes the stored key", () => {
  saveApiKey("stadia", "abc");
  assert.equal(loadApiKey("stadia"), "abc");
  saveApiKey("stadia", "");
  assert.equal(loadApiKey("stadia"), "");
  assert.equal(globalThis.localStorage.getItem("city-pin-map.stadia-key.v1"), null);
});

test("loadAllApiKeys: returns all three providers, empty by default", () => {
  assert.deepEqual(loadAllApiKeys(), { stadia: "", maptiler: "", thunderforest: "" });
  saveApiKey("maptiler", "mt-key");
  assert.deepEqual(loadAllApiKeys(), { stadia: "", maptiler: "mt-key", thunderforest: "" });
});

test("loadApiKey: getItem throw returns '' without throwing", () => {
  assert.equal(withThrowingGetItem(() => loadApiKey("stadia")), "");
});

test("saveApiKey: setItem throw shows a banner", () => {
  withThrowingSetItem(() => saveApiKey("stadia", "value"));
  assert.match(banner().textContent, /Could not save API key/);
});
