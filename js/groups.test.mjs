import "./test-helpers.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addGroup,
  removeGroup,
  updateGroup,
  listGroups,
  replaceAll,
  subscribe,
} from "./groups.js";

// groups.js is a singleton in-memory store, same shape as pins.js. Reset
// via the store's own replaceAll before every test.
beforeEach(() => {
  replaceAll([]);
});

test("addGroup stamps id/createdAt and stores name/color", () => {
  const before = Date.now();
  const group = addGroup({ name: "Favorites", color: "#ff0000" });
  const after = Date.now();

  assert.equal(typeof group.id, "string");
  assert.ok(group.id.length > 0);
  assert.equal(group.name, "Favorites");
  assert.equal(group.color, "#ff0000");
  assert.ok(group.createdAt >= before && group.createdAt <= after);

  assert.deepEqual(listGroups(), [group]);
});

test("addGroup notifies subscribers with a snapshot including the new group", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  const group = addGroup({ name: "A", color: "#111111" });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], [group]);
  unsubscribe();
});

test("removeGroup removes a group by id and notifies", () => {
  const a = addGroup({ name: "A", color: "#111111" });
  const b = addGroup({ name: "B", color: "#222222" });

  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  removeGroup(a.id);

  assert.deepEqual(listGroups(), [b]);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], [b]);
  unsubscribe();
});

test("removeGroup on a non-existent id is a safe no-op (no notify)", () => {
  addGroup({ name: "A", color: "#111111" });
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  removeGroup("does-not-exist");

  assert.equal(received.length, 0);
  assert.equal(listGroups().length, 1);
  unsubscribe();
});

test("updateGroup merges a patch, preserves id, and notifies", () => {
  const group = addGroup({ name: "A", color: "#111111" });
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  updateGroup(group.id, { name: "Renamed", color: "#00ff00" });

  const [updated] = listGroups();
  assert.equal(updated.id, group.id);
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.color, "#00ff00");
  assert.equal(received.length, 1);
  unsubscribe();
});

test("updateGroup patch cannot override id", () => {
  const group = addGroup({ name: "A", color: "#111111" });
  updateGroup(group.id, { id: "hijacked", name: "Still safe" });
  assert.equal(listGroups()[0].id, group.id);
});

test("updateGroup on a non-existent id is a safe no-op (no notify)", () => {
  const group = addGroup({ name: "A", color: "#111111" });
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  updateGroup("does-not-exist", { name: "Ghost" });

  assert.equal(received.length, 0);
  assert.deepEqual(listGroups(), [group]);
  unsubscribe();
});

test("listGroups returns a snapshot copy, not the live array", () => {
  addGroup({ name: "A", color: "#111111" });
  const snapshot = listGroups();
  snapshot.push({ id: "fake" });
  assert.equal(listGroups().length, 1);
});

test("replaceAll swaps the whole store and notifies once", () => {
  addGroup({ name: "A", color: "#111111" });
  addGroup({ name: "B", color: "#222222" });

  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  const next = [{ id: "x", name: "X", color: "#abcdef", createdAt: 1 }];
  replaceAll(next);

  assert.deepEqual(listGroups(), next);
  assert.equal(received.length, 1);
  unsubscribe();
});

test("subscribe returns an unsubscribe function that stops further notifications", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  addGroup({ name: "A", color: "#111111" });
  assert.equal(received.length, 1);

  unsubscribe();
  addGroup({ name: "B", color: "#222222" });
  assert.equal(received.length, 1); // no further notifications after unsubscribe
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

  addGroup({ name: "A", color: "#111111" });

  assert.deepEqual(calls, ["second"]);
  assert.equal(errSpy.mock.calls.length, 1);
});
