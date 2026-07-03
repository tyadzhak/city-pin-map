// Run with: node --test js/svg-ingest.test.mjs
//
// Covers the policy logic (allowlists, fill counting). Browser-only
// DOMParser/XMLSerializer paths are verified manually via the
// add-icon UI in the icon-picker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { walk, collectFills, parseStyleBlock } from "./svg-ingest.js";

// Minimal element shim that mimics the browser API surface our walker
// touches. Keeps tests dependency-free (no jsdom / linkedom).
function el(tagName, { attributes = {}, children = [] } = {}) {
  const attrEntries = Object.entries(attributes).map(([name, value]) => ({
    name,
    value: String(value),
  }));
  return {
    tagName,
    attributes: attrEntries,
    children,
    getAttribute(name) {
      const found = attrEntries.find((a) => a.name === name);
      return found ? found.value : null;
    },
  };
}

test("walk: accepts a clean svg with safe tags + attrs", () => {
  const svg = el("svg", {
    attributes: { viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg" },
    children: [
      el("path", { attributes: { d: "M0 0L10 10", fill: "black" } }),
    ],
  });
  const violations = [];
  walk(svg, violations);
  assert.deepEqual(violations, []);
});

test("walk: rejects <script>", () => {
  const svg = el("svg", {
    children: [el("script", { attributes: {} })],
  });
  const violations = [];
  walk(svg, violations);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /<script>/);
});

test("walk: rejects on* event handlers", () => {
  const svg = el("svg", {
    attributes: { onload: "alert(1)" },
  });
  const violations = [];
  walk(svg, violations);
  assert.match(violations[0], /onload=/);
});

test("walk: rejects javascript: in href", () => {
  const svg = el("svg", {
    children: [el("path", { attributes: { href: "javascript:alert(1)" } })],
  });
  const violations = [];
  walk(svg, violations);
  assert.match(violations[0], /href \(unsafe value\)/);
});

test("walk: accepts internal fragment href", () => {
  const svg = el("svg", {
    children: [el("path", { attributes: { href: "#myref" } })],
  });
  const violations = [];
  walk(svg, violations);
  assert.deepEqual(violations, []);
});

test("walk: rejects <foreignObject>", () => {
  const svg = el("svg", {
    children: [el("foreignObject", {})],
  });
  const violations = [];
  walk(svg, violations);
  assert.match(violations[0], /<foreignobject>/i);
});

test("collectFills: returns 'currentColor' for an svg with no fill attrs", () => {
  const svg = el("svg", {
    children: [el("path", { attributes: { d: "..." } })],
  });
  const fills = collectFills(svg);
  assert.deepEqual([...fills], ["currentColor"]);
});

test("collectFills: deduplicates same color", () => {
  const svg = el("svg", {
    children: [
      el("path", { attributes: { fill: "#ff0000" } }),
      el("path", { attributes: { fill: "#FF0000" } }),
    ],
  });
  const fills = collectFills(svg);
  assert.equal(fills.size, 1);
});

test("collectFills: counts distinct colors", () => {
  const svg = el("svg", {
    children: [
      el("path", { attributes: { fill: "red" } }),
      el("path", { attributes: { fill: "blue" } }),
      el("path", { attributes: { fill: "green" } }),
    ],
  });
  const fills = collectFills(svg);
  assert.equal(fills.size, 3);
});

test("walk: accepts Heroicons-shape attributes (clip-rule, data-*, aria-*)", () => {
  // Real-world example: Heroicons solid icons carry data-slot="icon",
  // aria-hidden="true", clip-rule="evenodd". All inert metadata; the
  // sanitizer should pass them through.
  const svg = el("svg", {
    attributes: {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      fill: "currentColor",
      "aria-hidden": "true",
      "data-slot": "icon",
    },
    children: [
      el("path", {
        attributes: {
          "fill-rule": "evenodd",
          "clip-rule": "evenodd",
          d: "M2.25 12c0-5.385",
        },
      }),
    ],
  });
  const violations = [];
  walk(svg, violations);
  assert.deepEqual(violations, []);
});

test("collectFills: ignores 'none' and url(...)", () => {
  const svg = el("svg", {
    children: [
      el("path", { attributes: { fill: "none" } }),
      el("path", { attributes: { fill: "url(#grad)" } }),
      el("path", { attributes: { fill: "black" } }),
    ],
  });
  const fills = collectFills(svg);
  assert.deepEqual([...fills], ["black"]);
});

// ── parseStyleBlock tests ──────────────────────────────────────────────
// These exercise the user-implemented CSS parser. They cover the design
// constraints called out in svg-ingest.js's TODO comment.

test("parseStyleBlock: simple class rule", () => {
  const rules = parseStyleBlock(".cls-1{fill:none;stroke:#000;}");
  assert.deepEqual(rules, [
    { classNames: ["cls-1"], declarations: { fill: "none", stroke: "#000" } },
  ]);
});

test("parseStyleBlock: multiple rules", () => {
  const rules = parseStyleBlock(".a{fill:red;}.b{fill:blue;}");
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], { classNames: ["a"], declarations: { fill: "red" } });
  assert.deepEqual(rules[1], { classNames: ["b"], declarations: { fill: "blue" } });
});

test("parseStyleBlock: comma-separated class selectors share one rule", () => {
  const rules = parseStyleBlock(".a, .b{fill:red;}");
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].classNames.sort(), ["a", "b"]);
  assert.deepEqual(rules[0].declarations, { fill: "red" });
});

test("parseStyleBlock: tolerates whitespace and trailing semicolons", () => {
  const rules = parseStyleBlock("  .cls-1  {  fill : none ; stroke : #000 ; }  ");
  assert.deepEqual(rules, [
    { classNames: ["cls-1"], declarations: { fill: "none", stroke: "#000" } },
  ]);
});

test("parseStyleBlock: lowercases property names but preserves value case", () => {
  const rules = parseStyleBlock(".x{FILL:#ABCDEF;}");
  assert.deepEqual(rules[0].declarations, { fill: "#ABCDEF" });
});

test("parseStyleBlock: silently skips non-class selectors", () => {
  const rules = parseStyleBlock("path{fill:red;}#id{fill:blue;}.cls{fill:green;}");
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0], { classNames: ["cls"], declarations: { fill: "green" } });
});

test("parseStyleBlock: returns [] for empty input", () => {
  assert.deepEqual(parseStyleBlock(""), []);
  assert.deepEqual(parseStyleBlock("   "), []);
});

test("parseStyleBlock: real-world svgrepo example", () => {
  // The exact <style> block from the user's anchor SVG.
  const rules = parseStyleBlock(
    ".cls-1{fill:none;stroke:#000000;stroke-linecap:round;stroke-linejoin:round;}"
  );
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].classNames, ["cls-1"]);
  assert.deepEqual(rules[0].declarations, {
    fill: "none",
    stroke: "#000000",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
});
