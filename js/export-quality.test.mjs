import test from "node:test";
import assert from "node:assert/strict";
import { resolveExportSize, isPrintEligible } from "./export-quality.js";

const A4P = { width: 794, height: 1123 };

test("print A4 portrait is 2480 x 3508", () => {
  assert.deepEqual(resolveExportSize("a4-portrait", A4P, "print"), {
    width: 2480,
    height: 3508,
  });
});

test("screen quality leaves the preset unchanged", () => {
  assert.deepEqual(resolveExportSize("a4-portrait", A4P, "screen"), A4P);
});

test("print keeps the preset aspect ratio (A3 landscape)", () => {
  const s = resolveExportSize("a3-landscape", { width: 1684, height: 1191 }, "print");
  assert.equal(s.width, 4961);
  assert.ok(Math.abs(s.height / s.width - 1191 / 1684) < 0.001);
});

test("non-eligible presets ignore print", () => {
  const photo = { width: 1181, height: 1772 };
  assert.deepEqual(resolveExportSize("photo-10x15-portrait", photo, "print"), photo);
  assert.equal(isPrintEligible("square"), false);
  assert.equal(resolveExportSize("current", null, "print"), null);
});

