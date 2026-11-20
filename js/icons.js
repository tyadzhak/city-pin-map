// Icon registry — single source of truth for the picker grid AND the map's
// MapLibre image registry. Merges built-in icons (this module) with
// user-uploaded icons (./user-icons.js) and notifies subscribers when the
// merged set changes. Map.js re-registers MapLibre images on every tick.
//
// Shape of a registry entry:
// {
//   id: string,                                                // public id used by pin.icon and the data-driven icon-image
//   label: string,                                             // user-visible name (picker tooltip)
//   category: "default" | "pins" | "travel" | "places" | "transport" | "markers" | "user",
//   tintable: boolean,                                         // SDF when true; raster RGBA when false
//   src?: string,                                              // path under assets/icons/ — built-in icons only
//   svg?: string,                                              // inline SVG string — user icons only
//   attribution?: { artistName: string|null, sourceUrl: string|null } | null,  // user icons only
// }
//
// Exactly one of `src` or `svg` is set per entry. Map.js's image-loader
// branches on which is present.

import * as userIcons from "./user-icons.js";

// Built-in icons. Categories ordered as they appear in the picker.
// Adding a new built-in icon:
//   1. Drop a 128×128 single-color SVG at assets/icons/<id>.svg
//   2. Append an entry below
//   3. (Optional) Update CLAUDE.md "What's shipped" if the count changes meaningfully
export const BUILTIN_ICONS = [
  // Sole built-in: the default neutral marker. Anything richer gets added
  // by the user via the icon-picker's "+ Add" sub-flow. Pins from older
  // sessions whose `icon` references a previous built-in (`map-pin`,
  // `star`, etc.) degrade to this via effectiveIcon's clamp-to-known-id
  // contract.
  { id: "circle", label: "Circle", category: "default", tintable: true, src: "assets/icons/circle.svg" },
];

export const DEFAULT_ICON_ID = "circle";

// Subscribers re-fire whenever the merged registry changes — either because
// a user icon was added/removed/replaced, or (rare) because the built-in
// list itself was hot-swapped during development. Map.js subscribes to
// rebuild MapLibre's image registry; pin-list / icon-picker subscribe to
// re-render any open UI.
const subscribers = [];
let mergedCache = null;

function rebuildMerged() {
  const userEntries = userIcons.list().map((u) => ({
    id: u.id,
    label: u.name,
    category: "user",
    tintable: u.tintable,
    svg: u.fillSvg,
    attribution: u.attribution,
  }));
  mergedCache = [...BUILTIN_ICONS, ...userEntries];
  return mergedCache;
}

function notifyMerged() {
  rebuildMerged();
  for (const fn of subscribers.slice()) {
    try {
      fn(mergedCache);
    } catch (err) {
      console.error("icon registry listener threw:", err);
    }
  }
}

// Subscribe to user-icon changes once at module-eval. Built-ins are static.
userIcons.subscribe(notifyMerged);

// URL an <img> (or CSS mask) can load for a registry entry.
export function iconUrl(entry) {
  if (!entry) return "";
  return entry.svg
    ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(entry.svg)
    : entry.src || "";
}

// Fills `host` (cleared first) with the icon glyph, sized by CSS. An SVG in
// an <img> can't inherit CSS color, so a TINTABLE icon renders as a CSS mask
// over a `currentColor` background — the host's `color` then tints it, exactly
// like the map's SDF tinting. Non-tintable icons keep their own colors (<img>).
export function renderIconGlyph(host, entry, fallbackLabel = "") {
  host.replaceChildren();
  const label = entry?.label || fallbackLabel;
  const url = iconUrl(entry);
  if (entry?.tintable && url) {
    const glyph = document.createElement("span");
    glyph.className = "icon-glyph-mask";
    glyph.setAttribute("role", "img");
    glyph.setAttribute("aria-label", label);
    const mask = `url("${url}")`;
    glyph.style.webkitMaskImage = mask;
    glyph.style.maskImage = mask;
    host.appendChild(glyph);
    return;
  }
  const img = document.createElement("img");
  img.alt = label;
  img.src = url;
  img.className = "icon-glyph-img";
  host.appendChild(img);
}

export function getMergedIcons() {
  if (mergedCache === null) rebuildMerged();
  return mergedCache.slice();
}

export function getIcon(id) {
  if (mergedCache === null) rebuildMerged();
  return mergedCache.find((i) => i.id === id);
}

export function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const idx = subscribers.indexOf(fn);
    if (idx !== -1) subscribers.splice(idx, 1);
  };
}

/**
 * Resolve the icon id a pin should render as. Returns DEFAULT_ICON_ID when
 * the pin has no icon set or its icon id isn't in the current merged
 * registry (older session, hand-edited storage, deleted user icon).
 * Render must never reference a missing image — MapLibre would log
 * "Image 'foo' could not be loaded" and drop the feature.
 */
export function effectiveIcon(pin) {
  if (!pin.icon) return DEFAULT_ICON_ID;
  if (mergedCache === null) rebuildMerged();
  return mergedCache.some((i) => i.id === pin.icon) ? pin.icon : DEFAULT_ICON_ID;
}
