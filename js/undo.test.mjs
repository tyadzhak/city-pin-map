import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setToastSink } from "./toast.js";
import { offerUndo, cancelUndo } from "./undo.js";
import { restorePin, listPins, replaceAll } from "./pins.js";
import { restoreGroup, listGroups, replaceAll as replaceGroups } from "./groups.js";

let toasts;
beforeEach(() => {
  cancelUndo();
  toasts = [];
  setToastSink((message, options) => toasts.push({ message, ...options }));
  replaceAll([]);
  replaceGroups([]);
});

test("offerUndo shows a toast with an Undo action that restores once", () => {
  let n = 0;
  offerUndo("Deleted X", () => n++);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].message, "Deleted X");
  assert.equal(toasts[0].action.label, "Undo");
  toasts[0].action.onClick();
  toasts[0].action.onClick();
  assert.equal(n, 1);
});

test("a newer offer invalidates the older Undo", () => {
  let a = 0;
  let b = 0;
  offerUndo("A", () => a++);
  offerUndo("B", () => b++);
  toasts[0].action.onClick();
  assert.equal(a, 0);
  toasts[1].action.onClick();
  assert.equal(b, 1);
});

test("restorePin re-inserts verbatim at the old index, idempotently", () => {
  const p = (id) => ({ id, name: id, lat: 0, lon: 0, color: null, group: null, icon: null, createdAt: 1, labelDx: 5, labelDy: -3 });
  replaceAll([p("a"), p("c")]);
  restorePin(p("b"), 1);
  assert.deepEqual(listPins().map((x) => x.id), ["a", "b", "c"]);
  assert.equal(listPins()[1].labelDx, 5);
  restorePin(p("b"), 0);
  assert.equal(listPins().length, 3);
});

test("restoreGroup re-inserts at the old index", () => {
  const g = (id) => ({ id, name: id, color: "#000", createdAt: 1 });
  replaceGroups([g("a"), g("c")]);
  restoreGroup(g("b"), 1);
  assert.deepEqual(listGroups().map((x) => x.id), ["a", "b", "c"]);
});
