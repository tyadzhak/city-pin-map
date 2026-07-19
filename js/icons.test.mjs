import "./test-helpers.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_ICONS, DEFAULT_ICON_ID, getMergedIcons, getIcon, subscribe, effectiveIcon } from "./icons.js";
import * as userIcons from "./user-icons.js";

// icons.js subscribes to user-icons.js's store at module-eval time
// (userIcons.subscribe(notifyMerged)), so clearing the user-icon store via
// its own replaceAll() also drives icons.js's mergedCache back to
// BUILTIN_ICONS-only before every test — exercising the exact "registry
// rebuild on user-icons$ change" contract this module owns.
beforeEach(() => {
  userIcons.replaceAll([]);
});

test("BUILTIN_ICONS contains exactly the one shipped built-in ('circle')", () => {
  assert.equal(BUILTIN_ICONS.length, 1);
  assert.equal(BUILTIN_ICONS[0].id, "circle");
  assert.equal(BUILTIN_ICONS[0].tintable, true);
  assert.equal(BUILTIN_ICONS[0].category, "default");
  assert.equal(typeof BUILTIN_ICONS[0].src, "string");
});

test("DEFAULT_ICON_ID points at the built-in circle icon", () => {
  assert.equal(DEFAULT_ICON_ID, "circle");
  assert.ok(BUILTIN_ICONS.some((i) => i.id === DEFAULT_ICON_ID));
});

test("getMergedIcons returns only built-ins when there are no user icons", () => {
  const merged = getMergedIcons();
  assert.deepEqual(merged, BUILTIN_ICONS);
});

test("getMergedIcons returns a snapshot copy, not the live cache", () => {
  const snapshot = getMergedIcons();
  snapshot.push({ id: "fake" });
  assert.deepEqual(getMergedIcons(), BUILTIN_ICONS);
});

test("adding a user icon merges it into getMergedIcons, mapped from the user-icon shape", () => {
  userIcons.add({
    name: "Custom Star",
    tintable: true,
    fillSvg: "<svg>star</svg>",
    attribution: { artistName: "Jane", sourceUrl: "https://example.com" },
  });

  const merged = getMergedIcons();
  assert.equal(merged.length, 2);
  const userEntry = merged.find((i) => i.category === "user");
  assert.ok(userEntry);
  assert.equal(userEntry.label, "Custom Star");
  assert.equal(userEntry.tintable, true);
  assert.equal(userEntry.svg, "<svg>star</svg>");
  assert.deepEqual(userEntry.attribution, { artistName: "Jane", sourceUrl: "https://example.com" });
  // Only user entries get `svg`; built-ins keep `src`. Confirms the
  // exactly-one-of-src-or-svg contract documented at the top of icons.js.
  assert.equal(userEntry.src, undefined);
});

test("removing a user icon drops it from getMergedIcons on the next rebuild", () => {
  userIcons.add({ name: "Temp", tintable: true, fillSvg: "<svg/>" });
  const [added] = userIcons.list();
  assert.equal(getMergedIcons().length, 2);

  userIcons.remove(added.id);

  assert.deepEqual(getMergedIcons(), BUILTIN_ICONS);
});

test("getIcon finds a built-in icon by id and returns undefined for an unknown id", () => {
  assert.equal(getIcon("circle").id, "circle");
  assert.equal(getIcon("does-not-exist"), undefined);
});

test("getIcon finds a merged-in user icon by id", () => {
  userIcons.add({ name: "Temp", tintable: false, fillSvg: "<svg/>" });
  const [added] = userIcons.list();
  const found = getIcon(added.id);
  assert.ok(found);
  assert.equal(found.label, "Temp");
});

test("subscribe fires with the merged list whenever the user-icon store changes", () => {
  const received = [];
  const unsubscribe = subscribe((merged) => received.push(merged));

  userIcons.add({ name: "A", tintable: true, fillSvg: "<svg/>" });

  assert.equal(received.length, 1);
  assert.equal(received[0].length, 2);
  unsubscribe();
});

test("subscribe returns an unsubscribe function that stops further notifications", () => {
  const received = [];
  const unsubscribe = subscribe((merged) => received.push(merged));

  userIcons.add({ name: "A", tintable: true, fillSvg: "<svg/>" });
  assert.equal(received.length, 1);

  unsubscribe();
  userIcons.add({ name: "B", tintable: true, fillSvg: "<svg/>" });
  assert.equal(received.length, 1);
});

test("unsubscribe is safe to call twice", () => {
  const unsubscribe = subscribe(() => {});
  unsubscribe();
  assert.doesNotThrow(() => unsubscribe());
});

test("a throwing icon-registry listener does not prevent other listeners from being notified", (t) => {
  const errSpy = t.mock.method(console, "error", () => {});
  const calls = [];
  const unsubscribeThrower = subscribe(() => {
    throw new Error("boom");
  });
  const unsubscribeSecond = subscribe(() => calls.push("second"));

  userIcons.add({ name: "A", tintable: true, fillSvg: "<svg/>" });

  assert.deepEqual(calls, ["second"]);
  assert.equal(errSpy.mock.calls.length, 1);
  // Unsubscribe both — the thrower especially, since leaving it attached
  // would fire (and print via the now-restored real console.error) on
  // every subsequent test's beforeEach userIcons.replaceAll([]) reset.
  unsubscribeThrower();
  unsubscribeSecond();
});

// ── effectiveIcon() — the fallback contract ────────────────────────────

test("effectiveIcon falls back to DEFAULT_ICON_ID when the pin has no icon set", () => {
  assert.equal(effectiveIcon({ icon: null }), DEFAULT_ICON_ID);
  assert.equal(effectiveIcon({ icon: undefined }), DEFAULT_ICON_ID);
  assert.equal(effectiveIcon({ icon: "" }), DEFAULT_ICON_ID);
});

test("effectiveIcon falls back to DEFAULT_ICON_ID when the pin's icon id is unknown", () => {
  assert.equal(effectiveIcon({ icon: "some-deleted-user-icon" }), DEFAULT_ICON_ID);
});

test("effectiveIcon returns the pin's icon id when it exists in the built-in registry", () => {
  assert.equal(effectiveIcon({ icon: "circle" }), "circle");
});

test("effectiveIcon returns the pin's icon id when it exists as a live user icon", () => {
  userIcons.add({ name: "Custom", tintable: true, fillSvg: "<svg/>" });
  const [added] = userIcons.list();
  assert.equal(effectiveIcon({ icon: added.id }), added.id);
});

test("effectiveIcon degrades to DEFAULT_ICON_ID once the referenced user icon is deleted", () => {
  userIcons.add({ name: "Custom", tintable: true, fillSvg: "<svg/>" });
  const [added] = userIcons.list();
  assert.equal(effectiveIcon({ icon: added.id }), added.id);

  userIcons.remove(added.id);

  assert.equal(effectiveIcon({ icon: added.id }), DEFAULT_ICON_ID);
});
