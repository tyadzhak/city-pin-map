// SVG ingestion for user-uploaded custom icons.
//
// Three concerns, in order:
//   1. Sanitize  — reject anything with XSS surface (script tags, foreign
//                  objects, event handlers, javascript: hrefs). Allowlist
//                  approach: only known-safe SVG elements/attrs survive.
//   2. Normalize — ensure outer viewBox exists; force outer width/height
//                  to 128 so the MapLibre image registry's pixelRatio:4
//                  setting renders at 32 CSS px (matches built-in icons).
//   3. Heuristic — count unique non-transparent fill colors. ≤1 → suggest
//                  tintable=true; ≥2 → suggest false. Returned alongside
//                  sanitized markup so the add-icon UI can pre-select the
//                  radio without forcing a choice.
//
// Public API: ingestSvg(rawText) → { ok: true, sanitizedSvg, suggestedTintable }
//                              | { ok: false, error: string }

// Allowlists are lowercase: the walker calls `.toLowerCase()` on tag and
// attribute names before consulting these sets. SVG itself is
// case-sensitive (camelCase `viewBox`, `clipPath`) but the safety check
// is intentionally case-insensitive — an attacker can't bypass by
// case-tweaking, and browsers won't apply non-canonical-case SVG attrs
// anyway, so the result is "either it's known and benign, or rejected."
const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "polygon", "polyline", "ellipse",
  "line", "defs", "clippath", "mask", "lineargradient", "radialgradient",
  "stop", "title", "desc",
]);

const ALLOWED_ATTRS = new Set([
  // Geometry
  "d", "cx", "cy", "r", "x", "y", "x1", "y1", "x2", "y2",
  "width", "height", "rx", "ry", "points",
  // Paint
  "fill", "fill-opacity", "fill-rule", "clip-rule",
  "stroke", "stroke-width",
  "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "opacity",
  // Transform / refs
  "transform", "viewbox", "preserveaspectratio",
  // Gradient stops
  "offset", "stop-color", "stop-opacity",
  "gradientunits", "gradienttransform",
  // Clip / mask refs (allowlisted with safe-href validation below)
  "clip-path", "mask", "id",
  // xlink:href is handled separately — only safe values survive.
  "href",
  // Aria
  "aria-label", "role",
  // viewBox companion
  "xmlns",
]);

const SAFE_HREF_RE = /^#[A-Za-z0-9_\-]+$/; // Internal fragment refs only.

export function ingestSvg(rawText) {
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    return { ok: false, error: "Empty SVG content." };
  }

  let doc;
  try {
    doc = new DOMParser().parseFromString(rawText, "image/svg+xml");
  } catch (err) {
    return { ok: false, error: "Could not parse SVG." };
  }

  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    return { ok: false, error: "SVG markup is malformed." };
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    return { ok: false, error: "Root element must be <svg>." };
  }

  // Flatten any `<style>` + `class=` styling into inline presentation
  // attributes, then drop the now-redundant `<style>` elements and class
  // attrs. This lets icons exported by Illustrator/Figma/svgrepo —
  // which commonly carry `<defs><style>.cls-1{...}</style></defs>` — pass
  // the violations walker. Anything we can't flatten (tag selectors,
  // pseudo-classes, etc.) is left in place; `walk()` below will then
  // reject it normally.
  flattenStylesIntoTree(root);

  const violations = [];
  walk(root, violations);
  if (violations.length > 0) {
    return {
      ok: false,
      error: `SVG contains content that can't be safely imported: ${violations.slice(0, 3).join(", ")}.`,
    };
  }

  normalizeOuter(root);

  const fills = collectFills(root);
  const suggestedTintable = fills.size <= 1;

  return {
    ok: true,
    sanitizedSvg: serializeRoot(root),
    suggestedTintable,
  };
}

// Walk the tree once. Reject any disallowed tag, attribute, or unsafe
// href. The walk mutates nothing — failure cases produce error messages
// rather than silent strips, so the user can fix and retry.
export function walk(el, violations) {
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    violations.push(`<${tag}>`);
    return;
  }
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    // on* event handlers — never safe.
    if (name.startsWith("on")) {
      violations.push(`${name}=`);
      continue;
    }
    // xlink:href / href — only fragment refs (#foo) are safe; reject
    // javascript:, data:, http:, etc.
    if (name === "href" || name === "xlink:href") {
      if (!SAFE_HREF_RE.test(attr.value || "")) {
        violations.push(`${name} (unsafe value)`);
      }
      continue;
    }
    // data-* and aria-* are allowed wholesale: both are designed to be
    // inert metadata that the rendering engine ignores for behavior. This
    // lets users paste Heroicons / Tabler / Phosphor SVGs verbatim
    // without hitting a confusing rejection on `data-slot="icon"` or
    // `aria-hidden="true"`. No XSS surface — neither prefix can trigger
    // script execution.
    if (name.startsWith("data-") || name.startsWith("aria-")) {
      continue;
    }
    // Strip namespace prefix for the allowlist check (e.g. xlink:href
    // already handled above; xml:space, xml:lang are unsafe noise).
    const local = name.includes(":") ? name.split(":")[1] : name;
    if (!ALLOWED_ATTRS.has(local)) {
      violations.push(`${name}=`);
    }
  }
  for (const child of Array.from(el.children)) {
    walk(child, violations);
  }
}

function normalizeOuter(svg) {
  // Force outer dimensions to 128. Keep the existing viewBox so paths
  // don't need rewriting. If no viewBox exists, derive one from the
  // pre-existing width/height; if those are absent, default to 0 0 24 24
  // (a sensible mid-ground for icon-grid sources).
  if (!svg.getAttribute("viewBox")) {
    const w = parseFloat(svg.getAttribute("width") || "");
    const h = parseFloat(svg.getAttribute("height") || "");
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    } else {
      svg.setAttribute("viewBox", "0 0 24 24");
    }
  }
  svg.setAttribute("width", "128");
  svg.setAttribute("height", "128");
  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
}

export function collectFills(svg) {
  const fills = new Set();
  function visit(el) {
    const f = (el.getAttribute && el.getAttribute("fill")) || null;
    if (f && f.toLowerCase() !== "none" && !f.startsWith("url(")) {
      fills.add(f.toLowerCase());
    }
    for (const child of el.children || []) visit(child);
  }
  visit(svg);
  // currentColor counts as a single tintable target (the SDF flow tints
  // it via icon-color); treat it as the "single fill" case.
  if (fills.size === 0) fills.add("currentColor");
  return fills;
}

function serializeRoot(el) {
  // XMLSerializer is browser-built-in. Trimming leading whitespace keeps
  // the data URL tidy.
  return new XMLSerializer().serializeToString(el).trim();
}

// ── Style flattening ────────────────────────────────────────────────────
//
// Real-world SVG icons (svgrepo, Illustrator, Figma "internal CSS"
// exports) bind their fills/strokes through `<style>` + `class=` instead
// of inline `fill=` attributes. The violations walker rejects both as a
// category, so without flattening the user hits a confusing "can't be
// safely imported" error on benign icons. We handle that here by
// expanding matching CSS rules into element attributes.

// Mutates `svgRoot` in place: collects all `<style>` block text, parses
// rules, applies matching declarations to elements as attributes (only
// for attributes the walker's allowlist already accepts), then strips
// the `<style>` elements and `class=` attributes. After this runs, the
// violations walker sees a tree as if the icon had been authored with
// inline presentation attributes from the start.
export function flattenStylesIntoTree(svgRoot) {
  const styleEls = Array.from(svgRoot.querySelectorAll("style"));
  if (styleEls.length === 0) return;

  const rules = [];
  for (const styleEl of styleEls) {
    rules.push(...parseStyleBlock(styleEl.textContent || ""));
  }

  // Index rules by class name for O(1) lookup per element.
  const rulesByClass = new Map();
  for (const rule of rules) {
    for (const cls of rule.classNames) {
      if (!rulesByClass.has(cls)) rulesByClass.set(cls, []);
      rulesByClass.get(cls).push(rule.declarations);
    }
  }

  // Walk the tree and apply matching rules to each element. Document
  // order is fine for cascade — last rule wins, matching CSS semantics
  // for equal-specificity rules.
  function applyTo(el) {
    const classAttr = el.getAttribute && el.getAttribute("class");
    if (classAttr) {
      const elClasses = classAttr.split(/\s+/).filter(Boolean);
      for (const cls of elClasses) {
        const matchingRules = rulesByClass.get(cls);
        if (!matchingRules) continue;
        for (const decls of matchingRules) {
          for (const [prop, value] of Object.entries(decls)) {
            // Don't overwrite an existing inline attribute — inline
            // wins per CSS specificity (style attrs > class rules).
            if (el.hasAttribute(prop)) continue;
            // Only apply properties the violations walker would accept;
            // anything else gets dropped silently rather than passed
            // through to be rejected later.
            if (!ALLOWED_ATTRS.has(prop)) continue;
            el.setAttribute(prop, value);
          }
        }
      }
      el.removeAttribute("class");
    }
    for (const child of Array.from(el.children)) applyTo(child);
  }
  applyTo(svgRoot);

  // Drop the `<style>` elements themselves (now redundant) plus any
  // `<defs>` left empty as a result — empty `<defs>` is harmless but
  // tidier to remove.
  for (const styleEl of styleEls) styleEl.remove();
  for (const defs of Array.from(svgRoot.querySelectorAll("defs"))) {
    if (defs.children.length === 0) defs.remove();
  }
}

// TODO(you): Implement this function.
//
// Parse the text content of an SVG `<style>` block into a list of rules.
//
// Input: a string like `.cls-1{fill:none;stroke:#000;}.cls-2{fill:red;}`
//
// Output: an array of objects with this shape:
//   [
//     { classNames: ["cls-1"], declarations: { fill: "none", stroke: "#000" } },
//     { classNames: ["cls-2"], declarations: { fill: "red" } },
//   ]
//
// Design constraints — read these before coding:
//
//   • Only support class selectors. A rule whose selector doesn't start
//     with `.` should be silently skipped (return no entry for it).
//     Examples to skip: `path { fill: red; }`, `#myid { … }`, `:hover`.
//
//   • Support comma-separated class selectors: `.a, .b { fill: red; }`
//     should produce ONE rule with `classNames: ["a", "b"]`.
//
//   • Be lenient with whitespace and trailing semicolons. `  .cls-1  {
//     fill: none ; stroke : #000 ; } ` should still parse cleanly.
//
//   • Property names and values get trimmed; property names should be
//     lowercased (since the walker's allowlist is lowercase). Values
//     should NOT be lowercased (colors and url() refs preserve case).
//
//   • Skip empty/malformed rules silently rather than throwing. The
//     downstream violation walker is the safety net; this function's
//     job is best-effort extraction.
//
// Hint: a tiny regex split approach works well — split on `}` to get
// individual rules, then on `{` to get selector + body, then on `;`
// for declarations, then on `:` for prop/value. No need for a real CSS
// parser. Take your time on the comma-separated selector case.
//
// Test it with: node --test js/svg-ingest.test.mjs
export function parseStyleBlock(cssText) {
  if (typeof cssText !== "string" || cssText.trim().length === 0) {
    return [];
  }
  const rules = [];
  for (const ruleText of cssText.split("}")) {
    const braceIdx = ruleText.indexOf("{");
    if (braceIdx === -1) continue;
    const selectorPart = ruleText.slice(0, braceIdx).trim();
    const body = ruleText.slice(braceIdx + 1).trim();
    if (!selectorPart || !body) continue;

    // Selector must be a comma-separated list of pure class selectors;
    // anything else (tag, id, descendant, pseudo-class) opts the rule
    // out entirely. We don't try to support partial matches — if you
    // wrote `.a, path` we drop the rule rather than honor `.a` alone,
    // because the CSS author's intent was for the rule to apply to
    // both, and partial application would change the visual output.
    const classNames = [];
    let allClass = true;
    for (const sel of selectorPart.split(",")) {
      const trimmed = sel.trim();
      if (!/^\.[A-Za-z_][\w\-]*$/.test(trimmed)) {
        allClass = false;
        break;
      }
      classNames.push(trimmed.slice(1));
    }
    if (!allClass || classNames.length === 0) continue;

    const declarations = {};
    for (const decl of body.split(";")) {
      const colonIdx = decl.indexOf(":");
      if (colonIdx === -1) continue;
      const prop = decl.slice(0, colonIdx).trim().toLowerCase();
      const value = decl.slice(colonIdx + 1).trim();
      if (prop && value) declarations[prop] = value;
    }
    if (Object.keys(declarations).length > 0) {
      rules.push({ classNames, declarations });
    }
  }
  return rules;
}
