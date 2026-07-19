// Run with: node --test js/svg-ingest.test.mjs
//
// Covers the policy logic (allowlists, fill counting). Browser-only
// DOMParser/XMLSerializer paths are verified manually via the
// add-icon UI in the icon-picker.

import "./xml-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { walk, collectFills, parseStyleBlock, ingestSvg, flattenStylesIntoTree } from "./svg-ingest.js";

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

test("walk: rejects an attribute not on the allowlist (generic case, not on*/href)", () => {
  const svg = el("svg", {
    children: [el("path", { attributes: { "xml:space": "preserve", d: "M0 0" } })],
  });
  const violations = [];
  walk(svg, violations);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /xml:space=/);
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

test("walk: rejects javascript: in namespace-prefixed href (x:href bypass)", () => {
  // A non-standard prefix must not let an unsafe href skip SAFE_HREF_RE by
  // matching the bare `href` local-part allowlist entry (FBL-023).
  const svg = el("svg", {
    children: [el("path", { attributes: { "x:href": "javascript:alert(1)" } })],
  });
  const violations = [];
  walk(svg, violations);
  assert.match(violations[0], /href \(unsafe value\)/);
});

test("walk: accepts internal fragment href with a namespace prefix", () => {
  // Safe fragment refs stay accepted regardless of prefix, matching the
  // treatment of bare href / xlink:href.
  const svg = el("svg", {
    children: [el("path", { attributes: { "x:href": "#grad" } })],
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

// ── ingestSvg tests (top-up: G-D) ──────────────────────────────────────
// Exercises the full public entry point via the local DOMParser/
// XMLSerializer shim in js/xml-shim.mjs — the browser-only surface that
// was previously unreachable under `node --test`.

test("ingestSvg: rejects empty/blank input without touching DOMParser", () => {
  assert.deepEqual(ingestSvg(""), { ok: false, error: "Empty SVG content." });
  assert.deepEqual(ingestSvg("   "), { ok: false, error: "Empty SVG content." });
  assert.equal(ingestSvg(null).ok, false);
  assert.equal(ingestSvg(undefined).ok, false);
});

test("ingestSvg: accepts a clean svg, normalizes outer width/height, reports tintable", () => {
  const result = ingestSvg(
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10" fill="black"/></svg>'
  );
  assert.equal(result.ok, true);
  assert.equal(result.suggestedTintable, true);
  assert.match(result.sanitizedSvg, /width="128"/);
  assert.match(result.sanitizedSvg, /height="128"/);
  assert.match(result.sanitizedSvg, /viewBox="0 0 24 24"/);
});

test("ingestSvg: derives a viewBox from pre-existing width/height when absent", () => {
  const result = ingestSvg('<svg width="32" height="32"><path d="M0 0"/></svg>');
  assert.equal(result.ok, true);
  assert.match(result.sanitizedSvg, /viewBox="0 0 32 32"/);
});

test("ingestSvg: falls back to a 0 0 24 24 viewBox when no dimensions exist at all", () => {
  const result = ingestSvg("<svg><path d=\"M0 0\"/></svg>");
  assert.equal(result.ok, true);
  assert.match(result.sanitizedSvg, /viewBox="0 0 24 24"/);
});

test("ingestSvg: adds a default xmlns when missing", () => {
  const result = ingestSvg('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>');
  assert.equal(result.ok, true);
  assert.match(result.sanitizedSvg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test("ingestSvg: multiple distinct fills suggest non-tintable", () => {
  const result = ingestSvg(
    '<svg viewBox="0 0 24 24"><path fill="red" d="M0 0"/><path fill="blue" d="M1 1"/></svg>'
  );
  assert.equal(result.ok, true);
  assert.equal(result.suggestedTintable, false);
});

test("ingestSvg: rejects markup with a disallowed tag (violations surfaced in error)", () => {
  const result = ingestSvg('<svg><script>alert(1)</script></svg>');
  assert.equal(result.ok, false);
  assert.match(result.error, /can't be safely imported/);
  assert.match(result.error, /<script>/);
});

test("ingestSvg: rejects a document whose root element is not <svg>", () => {
  const result = ingestSvg('<g><path d="M0 0"/></g>');
  assert.equal(result.ok, false);
  assert.equal(result.error, "Root element must be <svg>.");
});

test("ingestSvg: unparseable garbage yields the same 'root must be svg' error (no parsererror path in the shim)", () => {
  const result = ingestSvg("not xml at all");
  assert.equal(result.ok, false);
  assert.equal(result.error, "Root element must be <svg>.");
});

test("ingestSvg: flattens a <style> class rule into inline attributes and strips the <style> element", () => {
  const result = ingestSvg(
    '<svg viewBox="0 0 24 24"><defs><style>.cls-1{fill:#000000;}</style></defs><path class="cls-1" d="M0 0"/></svg>'
  );
  assert.equal(result.ok, true);
  assert.match(result.sanitizedSvg, /fill="#000000"/);
  assert.doesNotMatch(result.sanitizedSvg, /<style/);
  assert.doesNotMatch(result.sanitizedSvg, /class=/);
});

test("ingestSvg: a class rule targeting a disallowed property is dropped, not applied", () => {
  // `opacity` IS allowed but let's target something the walker doesn't
  // allowlist at all (e.g. an arbitrary custom property) to prove
  // flattenStylesIntoTree only ever writes allowlisted attributes.
  const result = ingestSvg(
    '<svg viewBox="0 0 24 24"><style>.cls-1{some-weird-prop:evil;}</style><path class="cls-1" d="M0 0"/></svg>'
  );
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.sanitizedSvg, /some-weird-prop/);
});

test("ingestSvg: inline attribute wins over a conflicting class rule", () => {
  const result = ingestSvg(
    '<svg viewBox="0 0 24 24"><style>.cls-1{fill:red;}</style><path class="cls-1" fill="blue" d="M0 0"/></svg>'
  );
  assert.equal(result.ok, true);
  assert.match(result.sanitizedSvg, /fill="blue"/);
  assert.doesNotMatch(result.sanitizedSvg, /fill="red"/);
});

test("flattenStylesIntoTree: no-op (returns immediately) when there is no <style> element", () => {
  const parser = new DOMParser();
  const doc = parser.parseFromString('<svg viewBox="0 0 24 24"><path d="M0 0" fill="black"/></svg>');
  const before = doc.documentElement.children.length;
  flattenStylesIntoTree(doc.documentElement);
  assert.equal(doc.documentElement.children.length, before);
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
