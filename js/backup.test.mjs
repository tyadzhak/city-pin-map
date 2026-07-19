// Run with: node --test js/backup.test.mjs
//
// Covers js/backup.js: exportToJson() (payload shape, download-anchor
// wiring, error path) and importFromJson() (v1/v2 shape validation,
// normalization of pins/groups/userIcons, the FBL-016 prewrite-atomicity
// contract, and the labelDx/labelDy export→import round-trip).
//
// js/xml-shim.mjs installs a hand-rolled DOMParser/XMLSerializer so
// normalizeUserIcons's call into svg-ingest.js's ingestSvg() can exercise
// its real accept/reject paths instead of always hitting the "DOMParser is
// not defined" catch branch.

import "./test-helpers.mjs";
import "./xml-shim.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resetStorage } from "./test-helpers.mjs";
import { exportToJson, importFromJson } from "./backup.js";
import * as pinStore from "./pins.js";
import * as groupStore from "./groups.js";
import * as userIconStore from "./user-icons.js";

const DEFAULT_GROUP_COLOR = "#e63946"; // mirrors backup.js's private constant

// ── Shared fixtures ─────────────────────────────────────────────────────

function makeFile(text, { rejectRead = false } = {}) {
  return {
    text: async () => {
      if (rejectRead) throw new Error("read failed");
      return text;
    },
  };
}

const CLEAN_SVG =
  '<svg viewBox="0 0 24 24"><path d="M0 0L10 10" fill="black"/></svg>';
const SCRIPTY_SVG = "<svg><script>alert(1)</script></svg>";

function samplePin(overrides = {}) {
  return {
    id: "pin-1",
    name: "Kyiv",
    lat: 50.45,
    lon: 30.52,
    color: "#123456",
    group: null,
    icon: null,
    createdAt: 1000,
    ...overrides,
  };
}

function sampleGroup(overrides = {}) {
  return {
    id: "group-1",
    name: "Favorites",
    color: "#abcdef",
    createdAt: 2000,
    ...overrides,
  };
}

// ── Setup / teardown ─────────────────────────────────────────────────────

let confirmReturn = true;
let confirmMessages = [];
let errorBanner = null;

beforeEach(() => {
  resetStorage();
  pinStore.replaceAll([]);
  groupStore.replaceAll([]);
  userIconStore.replaceAll([]);

  confirmReturn = true;
  confirmMessages = [];
  globalThis.confirm = (message) => {
    confirmMessages.push(message);
    return confirmReturn;
  };

  errorBanner = document.createElement("div");
  errorBanner.id = "error-banner";
  errorBanner.hidden = true;
  document.body.appendChild(errorBanner);
});

afterEach(() => {
  errorBanner?.remove();
});

// ── exportToJson ─────────────────────────────────────────────────────────

test("exportToJson: serializes a v2 payload with pins, groups, userIcons and triggers a download", async () => {
  pinStore.replaceAll([samplePin()]);
  groupStore.replaceAll([sampleGroup()]);
  userIconStore.replaceAll([
    {
      id: "icon-1",
      name: "star",
      tintable: true,
      fillSvg: CLEAN_SVG,
      attribution: null,
      createdAt: 3000,
    },
  ]);

  let capturedBlob = null;
  let createCalls = 0;
  let revokeCalls = 0;
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    capturedBlob = blob;
    createCalls++;
    return "blob:test-url";
  };
  URL.revokeObjectURL = (url) => {
    assert.equal(url, "blob:test-url");
    revokeCalls++;
  };

  const realCreateElement = document.createElement.bind(document);
  let lastAnchor = null;
  document.createElement = (tag) => {
    const el = realCreateElement(tag);
    if (tag === "a") lastAnchor = el;
    return el;
  };

  try {
    exportToJson();

    assert.equal(createCalls, 1);
    assert.equal(revokeCalls, 1);
    assert.ok(lastAnchor, "an anchor element should have been created");
    assert.equal(lastAnchor.href, "blob:test-url");
    assert.match(lastAnchor.download, /^city-pin-map-\d{4}-\d{2}-\d{2}\.json$/);

    assert.ok(capturedBlob, "Blob should have been created");
    const text = await capturedBlob.text();
    const payload = JSON.parse(text);
    assert.equal(payload.version, 2);
    assert.equal(typeof payload.exportedAt, "string");
    assert.equal(payload.pins.length, 1);
    assert.equal(payload.pins[0].id, "pin-1");
    assert.equal(payload.groups.length, 1);
    assert.equal(payload.groups[0].id, "group-1");
    assert.equal(payload.userIcons.length, 1);
    assert.equal(payload.userIcons[0].id, "icon-1");
  } finally {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    document.createElement = realCreateElement;
  }
});

test("exportToJson: a failure (e.g. createObjectURL throwing) is caught and never escapes", () => {
  const realCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = () => {
    throw new Error("boom");
  };
  try {
    assert.doesNotThrow(() => exportToJson());
    assert.equal(errorBanner.hidden, false);
    assert.match(errorBanner.textContent, /Could not export JSON/);
  } finally {
    URL.createObjectURL = realCreateObjectURL;
  }
});

// ── importFromJson: early-exit / validation paths ────────────────────────

test("importFromJson: no file is a silent no-op", async () => {
  await importFromJson(null);
  await importFromJson(undefined);
  assert.deepEqual(pinStore.listPins(), []);
});

test("importFromJson: file.text() rejecting surfaces a read error and leaves stores untouched", async () => {
  pinStore.replaceAll([samplePin()]);
  await importFromJson(makeFile("", { rejectRead: true }));
  assert.match(errorBanner.textContent, /Could not read that file/);
  assert.equal(pinStore.listPins().length, 1);
});

test("importFromJson: invalid JSON text surfaces a parse error and leaves stores untouched", async () => {
  pinStore.replaceAll([samplePin()]);
  await importFromJson(makeFile("{not valid json"));
  assert.match(errorBanner.textContent, /not valid JSON/);
  assert.equal(pinStore.listPins().length, 1);
});

test("importFromJson: a truncated/short file (valid JSON but not an object) is rejected", async () => {
  pinStore.replaceAll([samplePin()]);
  await importFromJson(makeFile("[]"));
  assert.match(errorBanner.textContent, /not a City Pin Map backup/);
  assert.equal(pinStore.listPins().length, 1);

  await importFromJson(makeFile("null"));
  assert.match(errorBanner.textContent, /not a City Pin Map backup/);

  await importFromJson(makeFile('"just a string"'));
  assert.match(errorBanner.textContent, /not a City Pin Map backup/);
});

test("importFromJson: a future format version is called out distinctly from an unsupported one", async () => {
  await importFromJson(makeFile(JSON.stringify({ version: 99, pins: [], groups: [] })));
  assert.match(errorBanner.textContent, /newer version of the app/);

  await importFromJson(makeFile(JSON.stringify({ version: 0, pins: [], groups: [] })));
  assert.match(errorBanner.textContent, /unsupported format version/);

  await importFromJson(makeFile(JSON.stringify({ pins: [], groups: [] })));
  assert.match(errorBanner.textContent, /unsupported format version/);
});

test("importFromJson: missing pins or groups arrays is rejected", async () => {
  await importFromJson(makeFile(JSON.stringify({ version: 2, groups: [], userIcons: [] })));
  assert.match(errorBanner.textContent, /missing pins or groups/);

  await importFromJson(makeFile(JSON.stringify({ version: 2, pins: [], userIcons: [] })));
  assert.match(errorBanner.textContent, /missing pins or groups/);
});

test("importFromJson: a v2 backup missing userIcons is rejected", async () => {
  await importFromJson(makeFile(JSON.stringify({ version: 2, pins: [], groups: [] })));
  assert.match(errorBanner.textContent, /missing the userIcons field/);
});

test("importFromJson: user declining the confirm() prompt leaves stores untouched", async () => {
  pinStore.replaceAll([samplePin({ id: "existing" })]);
  confirmReturn = false;
  await importFromJson(
    makeFile(JSON.stringify({ version: 2, pins: [samplePin({ id: "new" })], groups: [], userIcons: [] }))
  );
  assert.equal(pinStore.listPins().length, 1);
  assert.equal(pinStore.listPins()[0].id, "existing");
});

test("importFromJson: v1 backup shows the v1-specific confirm message; v2 shows the v2 message", async () => {
  await importFromJson(makeFile(JSON.stringify({ version: 1, pins: [], groups: [] })));
  assert.match(confirmMessages.at(-1), /left untouched/);

  await importFromJson(makeFile(JSON.stringify({ version: 2, pins: [], groups: [], userIcons: [] })));
  assert.doesNotMatch(confirmMessages.at(-1), /left untouched/);
});

// ── importFromJson: pin normalization ────────────────────────────────────

test("importFromJson: valid pins import through unchanged, invalid ones are dropped and summarized", async () => {
  const rawPins = [
    samplePin({ id: "good", name: "Kyiv", lat: 50.45, lon: 30.52 }),
    { id: "no-name", name: "", lat: 1, lon: 1 }, // blank name
    { id: "bad-lat", name: "X", lat: 999, lon: 1 }, // out of range
    { id: "bad-lon", name: "X", lat: 1, lon: -999 }, // out of range
    "not even an object",
  ];
  await importFromJson(
    makeFile(JSON.stringify({ version: 2, pins: rawPins, groups: [], userIcons: [] }))
  );

  const pins = pinStore.listPins();
  assert.equal(pins.length, 1);
  assert.equal(pins[0].id, "good");
  assert.match(errorBanner.textContent, /skipped 4 pins/);
});

test("importFromJson: pin defaults fill in for missing/invalid optional fields", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [{ name: "Somewhere", lat: 10, lon: 20 }], // no id/color/group/icon/createdAt
        groups: [],
        userIcons: [],
      })
    )
  );
  const [pin] = pinStore.listPins();
  assert.equal(typeof pin.id, "string");
  assert.ok(pin.id.length > 0);
  assert.equal(pin.color, "#e63946"); // pins.js DEFAULT_PIN_COLOR
  assert.equal(pin.group, null);
  assert.equal(pin.icon, null);
  assert.equal(typeof pin.createdAt, "number");
});

test("importFromJson: originalLat/originalLon only carry over when BOTH are finite and in range", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [
          samplePin({ id: "both-valid", originalLat: 1, originalLon: 2 }),
          samplePin({ id: "only-lat", originalLat: 1 }),
          samplePin({ id: "out-of-range", originalLat: 999, originalLon: 2 }),
        ],
        groups: [],
        userIcons: [],
      })
    )
  );
  const pins = pinStore.listPins();
  const byId = Object.fromEntries(pins.map((p) => [p.id, p]));
  assert.equal(byId["both-valid"].originalLat, 1);
  assert.equal(byId["both-valid"].originalLon, 2);
  assert.equal("originalLat" in byId["only-lat"], false);
  assert.equal("originalLat" in byId["out-of-range"], false);
});

test("importFromJson: labelDx/labelDy round-trip through export -> import", async () => {
  pinStore.replaceAll([samplePin({ labelDx: 12.5, labelDy: -4 })]);
  groupStore.replaceAll([]);
  userIconStore.replaceAll([]);

  let capturedBlob = null;
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    capturedBlob = blob;
    return "blob:test-url";
  };
  URL.revokeObjectURL = () => {};

  try {
    exportToJson();
    const text = await capturedBlob.text();

    // Simulate a fresh session/device: wipe the in-memory stores, then
    // import the exported bytes back.
    pinStore.replaceAll([]);
    await importFromJson(makeFile(text));

    const [pin] = pinStore.listPins();
    assert.equal(pin.labelDx, 12.5);
    assert.equal(pin.labelDy, -4);
  } finally {
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
  }
});

test("importFromJson: labelDx/labelDy are omitted (not zeroed) when absent from the source pin", async () => {
  await importFromJson(
    makeFile(JSON.stringify({ version: 2, pins: [samplePin({ id: "no-offset" })], groups: [], userIcons: [] }))
  );
  const [pin] = pinStore.listPins();
  assert.equal("labelDx" in pin, false);
  assert.equal("labelDy" in pin, false);
});

// ── importFromJson: group normalization ──────────────────────────────────

test("importFromJson: valid groups import through, invalid ones are dropped", async () => {
  const rawGroups = [
    sampleGroup({ id: "good" }),
    { id: "blank-name", name: "   ", color: "#111111" },
    42,
  ];
  await importFromJson(
    makeFile(JSON.stringify({ version: 2, pins: [], groups: rawGroups, userIcons: [] }))
  );
  const groups = groupStore.listGroups();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "good");
  assert.match(errorBanner.textContent, /skipped 2 groups/);
});

test("importFromJson: a group with a malformed color falls back to the default group color", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [],
        groups: [{ id: "g1", name: "Bad Color", color: "not-a-hex-color" }],
        userIcons: [],
      })
    )
  );
  const [group] = groupStore.listGroups();
  assert.equal(group.color, DEFAULT_GROUP_COLOR);
});

test("importFromJson: a group missing id/createdAt gets both generated", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({ version: 2, pins: [], groups: [{ name: "No Id" }], userIcons: [] })
    )
  );
  const [group] = groupStore.listGroups();
  assert.equal(typeof group.id, "string");
  assert.ok(group.id.length > 0);
  assert.equal(typeof group.createdAt, "number");
});

// ── importFromJson: userIcons normalization (v2 only) ────────────────────

test("importFromJson: v1 backups leave the local user-icon library untouched", async () => {
  userIconStore.replaceAll([
    { id: "local-1", name: "existing", tintable: true, fillSvg: CLEAN_SVG, attribution: null, createdAt: 1 },
  ]);
  await importFromJson(makeFile(JSON.stringify({ version: 1, pins: [], groups: [] })));
  const icons = userIconStore.list();
  assert.equal(icons.length, 1);
  assert.equal(icons[0].id, "local-1");
});

test("importFromJson: v2 backup replaces user icons wholesale; a valid SVG icon imports cleanly", async () => {
  userIconStore.replaceAll([
    { id: "stale", name: "stale", tintable: true, fillSvg: CLEAN_SVG, attribution: null, createdAt: 1 },
  ]);
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [],
        groups: [],
        userIcons: [
          {
            id: "fresh",
            name: "star",
            tintable: true,
            fillSvg: CLEAN_SVG,
            attribution: { artistName: "Jane", sourceUrl: "https://example.com" },
            createdAt: 5,
          },
        ],
      })
    )
  );
  const icons = userIconStore.list();
  assert.equal(icons.length, 1);
  assert.equal(icons[0].id, "fresh");
  assert.equal(icons[0].tintable, true);
  assert.match(icons[0].fillSvg, /<svg/);
  assert.deepEqual(icons[0].attribution, { artistName: "Jane", sourceUrl: "https://example.com" });
});

test("importFromJson: a user icon with unsafe SVG content is dropped and counted", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [],
        groups: [],
        userIcons: [
          { id: "bad", name: "evil", tintable: false, fillSvg: SCRIPTY_SVG, attribution: null, createdAt: 1 },
        ],
      })
    )
  );
  assert.equal(userIconStore.list().length, 0);
  assert.match(errorBanner.textContent, /skipped 1 custom icon/);
});

test("importFromJson: a user icon whose ingest THROWS (not just fails validation) is dropped and counted too", async () => {
  // ingestSvg guards its OWN `new DOMParser().parseFromString(...)` call in
  // a try/catch (a bad parse becomes {ok:false}, never a throw past
  // ingestSvg). The try/catch in normalizeUserIcons exists for a throw
  // AFTER that point — e.g. XMLSerializer blowing up during serializeRoot()
  // — which is genuinely uncaught inside svg-ingest.js. Exercise that.
  const realXMLSerializer = globalThis.XMLSerializer;
  globalThis.XMLSerializer = class {
    serializeToString() {
      throw new Error("serializer exploded");
    }
  };
  try {
    await importFromJson(
      makeFile(
        JSON.stringify({
          version: 2,
          pins: [],
          groups: [],
          userIcons: [{ id: "throws", fillSvg: CLEAN_SVG, attribution: null }],
        })
      )
    );
  } finally {
    globalThis.XMLSerializer = realXMLSerializer;
  }
  assert.equal(userIconStore.list().length, 0);
  assert.match(errorBanner.textContent, /skipped 1 custom icon/);
});

test("importFromJson: a user icon entry that isn't an object is dropped", async () => {
  await importFromJson(
    makeFile(JSON.stringify({ version: 2, pins: [], groups: [], userIcons: [null, "nope", 7] }))
  );
  assert.equal(userIconStore.list().length, 0);
  assert.match(errorBanner.textContent, /skipped 3 custom icons/);
});

test("importFromJson: a user icon with blank fillSvg is dropped without needing DOMParser", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [],
        groups: [],
        userIcons: [{ id: "blank", name: "blank", tintable: true, fillSvg: "", attribution: null, createdAt: 1 }],
      })
    )
  );
  assert.equal(userIconStore.list().length, 0);
});

test("importFromJson: user-icon defaults fill in id/name/tintable/createdAt when missing or malformed", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [],
        groups: [],
        userIcons: [{ fillSvg: CLEAN_SVG }],
      })
    )
  );
  const [icon] = userIconStore.list();
  assert.equal(typeof icon.id, "string");
  assert.ok(icon.id.length > 0);
  assert.equal(icon.name, "");
  assert.equal(icon.tintable, false);
  assert.equal(typeof icon.createdAt, "number");
  assert.equal(icon.attribution, null);
});

test("importFromJson: a non-object attribution (array/string) normalizes to null", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [],
        groups: [],
        userIcons: [
          { id: "a", fillSvg: CLEAN_SVG, attribution: ["not", "an", "object"] },
          { id: "b", fillSvg: CLEAN_SVG, attribution: "also not an object" },
        ],
      })
    )
  );
  const icons = userIconStore.list();
  assert.equal(icons.find((i) => i.id === "a").attribution, null);
  assert.equal(icons.find((i) => i.id === "b").attribution, null);
});

test("importFromJson: attribution fields that aren't strings normalize to null individually", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [],
        groups: [],
        userIcons: [
          { id: "a", fillSvg: CLEAN_SVG, attribution: { artistName: 42, sourceUrl: null } },
        ],
      })
    )
  );
  const [icon] = userIconStore.list();
  assert.deepEqual(icon.attribution, { artistName: null, sourceUrl: null });
});

// ── importFromJson: FBL-016 prewrite atomicity ───────────────────────────

test("importFromJson: a localStorage write failure during prewrite aborts the ENTIRE import (no partial apply)", async () => {
  pinStore.replaceAll([samplePin({ id: "existing-pin" })]);
  groupStore.replaceAll([sampleGroup({ id: "existing-group" })]);
  userIconStore.replaceAll([
    { id: "existing-icon", name: "x", tintable: true, fillSvg: CLEAN_SVG, attribution: null, createdAt: 1 },
  ]);

  const realSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = () => {
    throw new Error("quota exceeded");
  };

  try {
    await importFromJson(
      makeFile(
        JSON.stringify({
          version: 2,
          pins: [samplePin({ id: "incoming" })],
          groups: [sampleGroup({ id: "incoming-group" })],
          userIcons: [],
        })
      )
    );
  } finally {
    localStorage.setItem = realSetItem;
  }

  assert.match(errorBanner.textContent, /Import was NOT applied/);
  // Nothing should have been mutated: prewrite failed before any replaceAll.
  assert.equal(pinStore.listPins().length, 1);
  assert.equal(pinStore.listPins()[0].id, "existing-pin");
  assert.equal(groupStore.listGroups()[0].id, "existing-group");
  assert.equal(userIconStore.list()[0].id, "existing-icon");
});

test("importFromJson: prewrite failure also rolls back any key it already wrote (pins written before groups fails)", async () => {
  // pins key succeeds, groups key throws -> prewriteImportPayloads must
  // restore the pins key to its pre-attempt value, not leave the new
  // (unapplied) pins bytes sitting in storage.
  pinStore.replaceAll([samplePin({ id: "existing-pin" })]);
  const preexistingRaw = localStorage.getItem("city-pin-map.pins.v1");

  let calls = 0;
  const realSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    calls++;
    if (key === "city-pin-map.groups.v1") {
      throw new Error("quota exceeded on groups");
    }
    return realSetItem(key, value);
  };

  try {
    await importFromJson(
      makeFile(
        JSON.stringify({ version: 2, pins: [samplePin({ id: "incoming" })], groups: [], userIcons: [] })
      )
    );
  } finally {
    localStorage.setItem = realSetItem;
  }

  assert.ok(calls >= 2, "should have attempted to write pins then groups");
  assert.equal(localStorage.getItem("city-pin-map.pins.v1"), preexistingRaw);
  assert.equal(pinStore.listPins()[0].id, "existing-pin");
});

// ── importFromJson: a clean round-trip surfaces no drop summary ─────────

test("importFromJson: a fully clean v2 import shows no error banner text", async () => {
  await importFromJson(
    makeFile(
      JSON.stringify({
        version: 2,
        pins: [samplePin()],
        groups: [sampleGroup()],
        userIcons: [],
      })
    )
  );
  // showError was never called for this import, so the banner (created
  // fresh + hidden in beforeEach) stays hidden with no text written to it.
  assert.equal(errorBanner.hidden, true);
  assert.equal(errorBanner.textContent, "");
});
