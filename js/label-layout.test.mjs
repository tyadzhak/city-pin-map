import test from "node:test";
import assert from "node:assert/strict";
import { layoutLabels } from "./label-layout.js";

const measure = (t) => t.length * 7;
const base = { labelSize: 13, iconSize: 32, font: "13px x", measure };
const item = (id, ax, ay, extra = {}) => ({
  id, ax, ay, text: "Venice", manual: false, x: ax, y: ay + 13, ...extra,
});

function box(pos, text = "Venice") {
  const w = measure(text);
  return { x: pos.x - w / 2, y: pos.y, w, h: 13 * 1.25 };
}
function hit(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test("lone label keeps the default below position", () => {
  const r = layoutLabels({ ...base, items: [item("a", 100, 100)] });
  assert.deepEqual(r.get("a"), { x: 100, y: 113 });
});

test("clustered labels do not overlap", () => {
  const items = [item("a", 100, 100), item("b", 105, 100), item("c", 110, 102)];
  const r = layoutLabels({ ...base, items });
  const boxes = items.map((i) => box(r.get(i.id)));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) assert.equal(hit(boxes[i], boxes[j]), false);
});

test("manual label is untouched and avoided", () => {
  const items = [
    item("m", 100, 100, { manual: true, x: 140, y: 150 }),
    item("a", 100, 100),
  ];
  const r = layoutLabels({ ...base, items });
  assert.deepEqual(r.get("m"), { x: 140, y: 150 });
  assert.equal(hit(box(r.get("a")), box(r.get("m"))), false);
});

test("scaling inputs scales the arrangement", () => {
  const mk = (k) =>
    layoutLabels({
      items: [item("a", 100 * k, 100 * k, { y: 100 * k + 13 * k }), item("b", 100 * k + 5 * k, 100 * k, { y: 100 * k + 13 * k })],
      labelSize: 13 * k, iconSize: 32 * k, font: "x", measure: (t) => t.length * 7 * k,
    });
  const a = mk(1), b = mk(2);
  assert.ok(Math.abs(b.get("b").x - a.get("b").x * 2) < 1e-6);
  assert.ok(Math.abs(b.get("b").y - a.get("b").y * 2) < 1e-6);
});

test("falls back to below when nothing is free", () => {
  const items = [];
  for (let i = 0; i < 40; i++) items.push(item("p" + i, 100, 100));
  const r = layoutLabels({ ...base, items });
  assert.equal(r.size, 40);
});

test("empty input", () => {
  assert.equal(layoutLabels({ ...base, items: [] }).size, 0);
});
