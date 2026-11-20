// Node-only tests for js/geo-wrap.js (FBL-027): longitude wrapping toward a
// map center so DOM labels / box-select hit-tests land on the same world copy
// MapLibre draws the pin icon on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapLngNear, projectNearCenter } from "./geo-wrap.js";

test("wrapLngNear leaves a longitude already within 180 of the center alone", () => {
  assert.equal(wrapLngNear(10, 0), 10);
  assert.equal(wrapLngNear(-120, -60), -120);
  assert.equal(wrapLngNear(150, 150), 150);
});

test("wrapLngNear crosses +180 -> -180 (pin west of the date line, center east)", () => {
  assert.equal(wrapLngNear(-172, 150), 188);
});

test("wrapLngNear crosses -180 -> +180 (pin east of the date line, center west)", () => {
  assert.equal(wrapLngNear(170, -170), -190);
});

test("wrapLngNear handles multiples of 360 in either direction", () => {
  assert.equal(wrapLngNear(10 + 720, 0), 10);
  assert.equal(wrapLngNear(10 - 720, 0), 10);
  assert.equal(wrapLngNear(-172, 150 + 360), 188 + 360);
  assert.equal(wrapLngNear(-172, 150 - 360), -172);
});

test("wrapLngNear result is always within 180 of the center", () => {
  for (const lon of [-180, -172, -90, 0, 45, 179.9, 180]) {
    for (const center of [-540, -360, -181, -180, -10, 0, 150, 180, 181, 360, 725]) {
      const w = wrapLngNear(lon, center);
      assert.ok(Math.abs(w - center) <= 180 + 1e-9, `lon ${lon} center ${center} -> ${w}`);
      // Same physical meridian: differs from the input by whole turns only.
      assert.equal(((w - lon) % 360 + 360) % 360, 0);
    }
  }
});

test("wrapLngNear with the center exactly at +/-180", () => {
  // -180 and +180 are the same meridian; either copy is within 180 of 180.
  assert.equal(wrapLngNear(180, 180), 180);
  assert.equal(wrapLngNear(-180, 180), 180);
  assert.equal(wrapLngNear(-180, -180), -180);
  assert.equal(wrapLngNear(180, -180), -180);
  // A pin just east of the antimeridian, centered exactly on it.
  assert.equal(wrapLngNear(-179, 180), 181);
  assert.equal(wrapLngNear(179, -180), -181);
});

test("wrapLngNear returns the input for non-finite arguments", () => {
  assert.ok(Number.isNaN(wrapLngNear(Number.NaN, 0)));
  assert.equal(wrapLngNear(12, Number.NaN), 12);
  assert.equal(wrapLngNear(12, Infinity), 12);
});

test("projectNearCenter projects the wrapped longitude", () => {
  let seen = null;
  const map = {
    getCenter: () => ({ lng: 150, lat: -15 }),
    project: (lngLat) => {
      seen = lngLat;
      return { x: 1, y: 2 };
    },
  };
  assert.deepEqual(projectNearCenter(map, -172.1, -13.8), { x: 1, y: 2 });
  assert.deepEqual(seen, [187.9, -13.8]);
});

test("projectNearCenter falls back to the raw longitude without getCenter", () => {
  let seen = null;
  const map = {
    project: (lngLat) => {
      seen = lngLat;
      return { x: 0, y: 0 };
    },
  };
  projectNearCenter(map, -172, 5);
  assert.deepEqual(seen, [-172, 5]);
});
