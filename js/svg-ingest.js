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
