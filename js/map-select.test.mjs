// Node-only tests for js/map-select.js's PURE geometry helpers
// (normalizeRect / rectContainsPoint / pinsInRect). The rest of the module
// is DOM/MapLibre interaction code exercised by the browser coverage
// scenarios (test/coverage/scenarios) rather than here — see the module's
// own header comment and CLAUDE.md's Testing section for why it's off the
// `npm run coverage` gate's --include list, matching every other DOM-heavy
// js/map-*.js overlay module.
//
// Importing js/map-select.js at module scope is safe under plain Node (no
// DOM/jsdom): every DOM/MapLibre touch in that module happens inside
// functions invoked only via init()/interaction callbacks, never at
// top-level import time — same contract js/map-inset.js and friends rely on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRect, rectContainsPoint, pinsInRect } from "./map-select.js";

test("normalizeRect canonicalizes any two corners into left/top/right/bottom", () => {
  assert.deepEqual(normalizeRect(10, 10, 50, 60), {
    left: 10,
    top: 10,
    right: 50,
    bottom: 60,
  });
  // Reversed drag direction (up-left) must produce the SAME rectangle.
  assert.deepEqual(normalizeRect(50, 60, 10, 10), {
    left: 10,
    top: 10,
    right: 50,
    bottom: 60,
  });
  // Mixed corners (down-left drag).
  assert.deepEqual(normalizeRect(10, 60, 50, 10), {
    left: 10,
    top: 10,
    right: 50,
    bottom: 60,
  });
  // Degenerate zero-area rect (a click with no movement).
  assert.deepEqual(normalizeRect(5, 5, 5, 5), {
    left: 5,
    top: 5,
    right: 5,
    bottom: 5,
  });
});

test("rectContainsPoint is inclusive of the rectangle's edges", () => {
  const rect = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.equal(rectContainsPoint(rect, 5, 5), true);
  assert.equal(rectContainsPoint(rect, 0, 0), true);
  assert.equal(rectContainsPoint(rect, 10, 10), true);
  assert.equal(rectContainsPoint(rect, 10, 0), true);
  assert.equal(rectContainsPoint(rect, -0.01, 5), false);
  assert.equal(rectContainsPoint(rect, 5, 10.01), false);
  assert.equal(rectContainsPoint(rect, 20, 20), false);
});

test("pinsInRect returns only the ids of points inside the rect, preserving input order", () => {
  const rect = { left: 0, top: 0, right: 100, bottom: 100 };
  const points = [
    { id: "a", x: 10, y: 10 },
    { id: "b", x: 200, y: 10 }, // outside on x
    { id: "c", x: 50, y: 50 },
    { id: "d", x: 10, y: 200 }, // outside on y
  ];
  assert.deepEqual(pinsInRect(points, rect), ["a", "c"]);
});

test("pinsInRect ignores null/undefined entries defensively", () => {
  const rect = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.deepEqual(
    pinsInRect([null, { id: "x", x: 5, y: 5 }, undefined], rect),
    ["x"]
  );
});

test("pinsInRect handles an empty point set and a zero-area rect (boundary point still matches)", () => {
  assert.deepEqual(pinsInRect([], { left: 0, top: 0, right: 10, bottom: 10 }), []);
  const zeroRect = normalizeRect(5, 5, 5, 5);
  assert.deepEqual(pinsInRect([{ id: "z", x: 5, y: 5 }], zeroRect), ["z"]);
  assert.deepEqual(pinsInRect([{ id: "z", x: 5.01, y: 5 }], zeroRect), []);
});

test("normalizeRect + pinsInRect compose correctly for a real drag (down-right through several pins)", () => {
  const points = [
    { id: "paris", x: 12, y: 40 },
    { id: "tokyo", x: 500, y: 500 },
    { id: "nairobi", x: 30, y: 60 },
  ];
  // Drag started bottom-right of the cursor's final position (an up-left
  // drag), so normalizeRect must still produce a rect that contains paris +
  // nairobi but not the far-off tokyo point.
  const rect = normalizeRect(100, 100, 0, 0);
  assert.deepEqual(pinsInRect(points, rect), ["paris", "nairobi"]);
});
