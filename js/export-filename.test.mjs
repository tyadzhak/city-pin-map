import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, buildExportFilename } from "./export-quality.js";

test("slugify lowercases, hyphenates and strips accents", () => {
  assert.equal(slugify("My Trip: Zürich & Köln!"), "my-trip-zurich-koln");
});

test("slugify caps length without trailing hyphen", () => {
  const s = slugify("a".repeat(30) + " " + "b".repeat(30));
  assert.ok(s.length <= 40);
  assert.ok(!s.endsWith("-"));
});

test("slugify returns empty for non-ASCII-only or non-string input", () => {
  assert.equal(slugify("東京"), "");
  assert.equal(slugify(null), "");
});

test("buildExportFilename uses the first non-empty line", () => {
  const lines = [{ text: "  " }, { text: "Summer 2026" }, { text: "Other" }];
  assert.equal(buildExportFilename(lines, "2026-11-20"), "summer-2026-2026-11-20.png");
});

test("buildExportFilename falls back when no usable title", () => {
  assert.equal(buildExportFilename([], "2026-11-20"), "city-pin-map-2026-11-20.png");
  assert.equal(buildExportFilename(null, "2026-11-20"), "city-pin-map-2026-11-20.png");
  assert.equal(buildExportFilename([{ text: "東京" }], "2026-11-20"), "city-pin-map-2026-11-20.png");
});
