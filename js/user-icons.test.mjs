import "./test-helpers.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { add, remove, list, replaceAll, subscribe } from "./user-icons.js";

// user-icons.js is a singleton in-memory store, same shape as pins.js/
// groups.js. Reset via the store's own replaceAll before every test.
beforeEach(() => {
  replaceAll([]);
});

test("add stamps id/createdAt, coerces tintable, and defaults attribution to null", () => {
  const before = Date.now();
  add({ name: "Star", tintable: true, fillSvg: "<svg></svg>" });
  const after = Date.now();

  const [icon] = list();
  assert.equal(typeof icon.id, "string");
  assert.ok(icon.id.length > 0);
  assert.equal(icon.name, "Star");
  assert.equal(icon.tintable, true);
  assert.equal(icon.fillSvg, "<svg></svg>");
  assert.equal(icon.attribution, null);
  assert.ok(icon.createdAt >= before && icon.createdAt <= after);
});

test("add coerces a truthy/falsy non-boolean tintable via Boolean()", () => {
  add({ name: "A", tintable: 1, fillSvg: "<svg/>" });
  add({ name: "B", tintable: 0, fillSvg: "<svg/>" });
  add({ name: "C", tintable: undefined, fillSvg: "<svg/>" });

  const [a, b, c] = list();
  assert.equal(a.tintable, true);
  assert.equal(b.tintable, false);
  assert.equal(c.tintable, false);
});

test("add preserves an explicit attribution object", () => {
  const attribution = { artistName: "Jane", sourceUrl: "https://example.com" };
  add({ name: "A", tintable: false, fillSvg: "<svg/>", attribution });
  assert.deepEqual(list()[0].attribution, attribution);
});

test("add notifies subscribers with a snapshot including the new icon", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  add({ name: "A", tintable: true, fillSvg: "<svg/>" });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], list());
  unsubscribe();
});

test("remove removes an icon by id and notifies", () => {
  add({ name: "A", tintable: true, fillSvg: "<svg/>" });
  add({ name: "B", tintable: true, fillSvg: "<svg/>" });
  const [a, b] = list();

  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  remove(a.id);

  assert.deepEqual(list(), [b]);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], [b]);
  unsubscribe();
});

test("remove on a non-existent id is a safe no-op (no notify)", () => {
  add({ name: "A", tintable: true, fillSvg: "<svg/>" });
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  remove("does-not-exist");

  assert.equal(received.length, 0);
  assert.equal(list().length, 1);
  unsubscribe();
});

test("list returns a snapshot copy, not the live array", () => {
  add({ name: "A", tintable: true, fillSvg: "<svg/>" });
  const snapshot = list();
  snapshot.push({ id: "fake" });
  assert.equal(list().length, 1);
});

test("replaceAll swaps the whole store and notifies once", () => {
  add({ name: "A", tintable: true, fillSvg: "<svg/>" });
  add({ name: "B", tintable: true, fillSvg: "<svg/>" });

  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  const next = [
    { id: "x", name: "X", tintable: false, fillSvg: "<svg/>", attribution: null, createdAt: 1 },
  ];
  replaceAll(next);

  assert.deepEqual(list(), next);
  assert.equal(received.length, 1);
  unsubscribe();
});

test("subscribe returns an unsubscribe function that stops further notifications", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  add({ name: "A", tintable: true, fillSvg: "<svg/>" });
  assert.equal(received.length, 1);

  unsubscribe();
  add({ name: "B", tintable: true, fillSvg: "<svg/>" });
  assert.equal(received.length, 1);
});

test("unsubscribe is safe to call twice", () => {
  const unsubscribe = subscribe(() => {});
  unsubscribe();
  assert.doesNotThrow(() => unsubscribe());
});

test("a throwing listener does not prevent other listeners from being notified", (t) => {
  const errSpy = t.mock.method(console, "error", () => {});
  const calls = [];
  subscribe(() => {
    throw new Error("boom");
  });
  subscribe(() => calls.push("second"));

  add({ name: "A", tintable: true, fillSvg: "<svg/>" });

  assert.deepEqual(calls, ["second"]);
  assert.equal(errSpy.mock.calls.length, 1);
});
