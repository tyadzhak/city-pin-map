# Pin icon library — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing 6-icon picker (PI-001, shipped) to a ~26-icon library with categories, search, and a user-add flow that lets users import custom SVG icons (e.g. from Flaticon) which persist in `localStorage` across sessions. Add hybrid color support so tintable monochrome icons keep the SDF tint contract while full-color custom icons render as-is with a color ring underneath for group-color visibility.

**Architecture:** Build incrementally on top of PI-001's shipped state (sprite-prefixed image registry, `icon-halo-*` paint replacing the shadow companion, `effectiveIcon(pin)` materialization). Extract the icon registry to its own module so it can merge built-in icons with user-supplied ones from a new `localStorage`-backed store. Replace the per-pin popover with a modal that hosts both the grid view and an add-icon sub-flow (file drop / textarea paste / URL field for attribution metadata only — never fetched). Add a circle layer beneath the existing fill layer to render the group-color ring for non-tintable shapes.

**Tech Stack:** Vanilla ES modules, MapLibre GL JS 4.7.1 (CDN), no build step, Node `--test` for the one pure-logic module that warrants unit tests (svg-ingest). All other verification is in-browser per CLAUDE.md "Definition of done."

## Reference

- Spec: `docs/superpowers/specs/2026-05-10-pin-shape-library-design.md`
- Predecessors (Done): PO-002 (labels), PO-003 (drop-pin markers), PI-001 (the 2026-05-09 pin-icon-picker design — shipped to the codebase even though no plan was written; see spec's "Relationship to the 2026-05-09 design" section).

## Current state (PI-001, shipped)

The codebase already has these pieces. **DO NOT recreate or rewrite them; the tasks below extend them.**

| Component | Where | What it does |
|---|---|---|
| `PIN_ICONS` array | `js/map.js:364-371` | 6 entries `{ id, label, src }` for map-pin/circle/star/heart/flag/house. |
| `DEFAULT_PIN_ICON` const | `js/map.js:372` | `"map-pin"` — default fallback. |
| `PIN_ICON_IMAGE_PREFIX` const | `js/map.js:363` | `"city-pin-map.icon."` — namespace prefix to avoid basemap atlas collisions. |
| `effectiveIcon(pin)` | `js/map.js:749-752` | Clamps `pin.icon` to known ids; falls back to `DEFAULT_PIN_ICON`. |
| `effectiveColor(pin)` | `js/map.js:736-740` | Group color override. |
| `pinsToFeatureCollection` | `js/map.js:778-792` | Materializes `id, name, color, icon` per feature. |
| `loadPinIconImages` | `js/map.js:806-814` | Promise.all loop fetching each PIN_ICONS src as `Image()`. |
| `addPinAndRouteLayers` image registration | `js/map.js:850-862` | Loops PIN_ICONS, calls `addImage` with `{ sdf: true, pixelRatio: 4 }`, prefixes id. Re-registers on every styledata. |
| Single fill layer with halo paint | `js/map.js:902-931` | `pins-fill` symbol layer, data-driven `icon-image` via `concat` + `coalesce`, `icon-color` from `["get", "color"]`, `icon-halo-color: "#ffffff"` + `icon-halo-width: 1.5` + `icon-halo-blur: 2`. |
| Labels layer | `js/map.js:939-970` | `pins-labels` layer, added LAST so it z-stacks above pins. |
| Appearance popover | `js/pin-list.js:235-468` | `openAppearancePopover` + `buildPopoverContent` + `buildIconChoice` + `positionPopover`. Renders a 2×3 icon grid + native color input. **Will be replaced by modal in this plan.** |
| 6 source SVGs | `assets/icons/{circle,flag,heart,house,map-pin,star}.svg` | 128×128 source size, MIT-licensed Heroicons + one hand-authored circle. |

The pin model in `js/pins.js:15-28` does NOT formally declare `icon` — it flows through informally via the spread-merge in `updatePin`. **Task 1 formalizes it.**

## File structure

### New files
```
js/icons.js                           # Icon registry: BUILTIN_ICONS array + getMergedIcons() + subscribe()
js/user-icons.js                      # User-icon store (pub/sub + localStorage), mirrors pins.js shape
js/svg-ingest.js                      # Pure: sanitize + normalize + tintable heuristic
js/svg-ingest.test.mjs                # Node :test runner unit tests for svg-ingest
js/icon-picker.js                     # Modal: grid view + add-icon sub-view + per-icon delete
assets/icons/<id>.svg                 # ~20 additional SVGs (travel + places + transport + markers categories)
```

### Modified files
```
js/map.js                             # Route through icons.js; add tintable materialization + color-ring layer; subscribe to user-icons changes
js/pin-list.js                        # Switch trigger from popover → modal; delete popover code
js/pins.js                            # Formalize icon field on addPin signature + JSDoc
js/app.js                             # Hydrate user-icons$ before pin store subscribers
js/backup.js                          # v1 ↔ v2 migration; include userIcons in v2
css/styles.css                        # Modal overlay styles; color-ring offset; thumbnail tweaks; remove old popover styles
CLAUDE.md                             # "What's shipped" entry; update file count and module summary
```

### Deleted files
```
(none — no PO-003-era assets remain; assets/pin-{fill,shadow}.svg already gone)
```

---

## Task 1: Formalize the `icon` field on the pin model

**Files:**
- Modify: `js/pins.js`

PI-001 added `pin.icon` to the data model informally — `updatePin(id, { icon: id })` flows through the spread-merge but `addPin` doesn't accept it as a parameter and there's no JSDoc. Formalize it so future readers and the import path know the field exists.

- [ ] **Step 1: Open `js/pins.js`. Replace the `addPin` function (lines 15-28) with:**

```js
/**
 * Add a new pin to the store.
 *
 * @param {object} input
 * @param {string} input.name - User-facing label.
 * @param {number} input.lat
 * @param {number} input.lon
 * @param {string} input.color - Hex like "#e63946". Overridden visually by group color when assigned.
 * @param {string|null} [input.group=null] - Group id; null means ungrouped.
 * @param {string|null} [input.icon=null] - Icon id from the registry; null falls back to DEFAULT_PIN_ICON at render time.
 * @returns {object} The created pin.
 */
export function addPin({ name, lat, lon, color, group = null, icon = null }) {
  const pin = {
    id: crypto.randomUUID(),
    name,
    lat,
    lon,
    color,
    group,
    icon,
    createdAt: Date.now(),
  };
  pins.push(pin);
  notify();
  return pin;
}
```

- [ ] **Step 2: Verify in browser**
  1. Open the app via `start.command` (or `python3 -m http.server` + browse to `localhost:8000`).
  2. Add a pin via search; check DevTools → Application → Local Storage → `city-pin-map.pins.v1`. The new pin's JSON should include `"icon":null`.
  3. Open the existing appearance popover, pick a non-default icon (e.g. star). Verify the LS entry now has `"icon":"star"`.
  4. Reload the page. Verify the marker still renders as a star.

- [ ] **Step 3: Commit**

```bash
git add js/pins.js
git commit -m "feat(pins): formalize icon field on pin model

Adds icon as an explicit, documented parameter to addPin. The field
was already flowing through updatePin via spread-merge since PI-001;
this just makes the contract explicit so backup/restore and the
upcoming user-icon store can rely on it."
```

---

## Task 2: User-icon store (`js/user-icons.js`)

**Files:**
- Create: `js/user-icons.js`
- Modify: `js/storage.js` (add `loadUserIcons` / `saveUserIcons` and the storage key)

Mirrors the pub/sub shape of `js/pins.js` and `js/groups.js`. localStorage hydrate-on-attach pattern from `attachStorage`.

- [ ] **Step 1: Append to `js/storage.js` near the other STORAGE_KEY consts (after line 14):**

```js
// User-uploaded icon library (PIL-001, this milestone). Same defensive load
// shape as loadPins/loadGroups: missing key → empty, corrupt → empty + banner.
const USER_ICONS_KEY = "city-pin-map.user-icons.v1";
```

- [ ] **Step 2: Add the load/save functions in `js/storage.js`. Place them after `saveGroups` (around line 94):**

```js
export function loadUserIcons() {
  let raw;
  try {
    raw = localStorage.getItem(USER_ICONS_KEY);
  } catch (err) {
    console.error("localStorage unavailable on read:", err);
    showError("Saved custom icons could not be read; starting empty.");
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("saved user icons is not an array");
    return parsed;
  } catch (err) {
    console.error("saved user icons corrupt; ignoring:", err);
    showError("Saved custom icons were corrupted and have been ignored.");
    return [];
  }
}

export function saveUserIcons(icons) {
  try {
    localStorage.setItem(USER_ICONS_KEY, JSON.stringify(icons));
  } catch (err) {
    console.error("failed to save user icons:", err);
    showError(
      "Could not save custom icons (storage may be full). Changes are kept in memory only."
    );
  }
}

export function attachUserIconStorage(userIconStore) {
  userIconStore.replaceAll(loadUserIcons());
  return userIconStore.subscribe(saveUserIcons);
}
```

- [ ] **Step 3: Create `js/user-icons.js`:**

```js
// User-uploaded custom icons. Mirrors the pub/sub shape of pins.js and
// groups.js so the registry merge in icons.js can subscribe uniformly.
//
// Shape of a user icon (see spec § Data model):
// {
//   id: string,                  // crypto.randomUUID()
//   name: string,                // user-supplied
//   tintable: boolean,           // SDF when true; raster RGBA when false
//   fillSvg: string,             // sanitized SVG markup (monochrome if tintable)
//   attribution: { artistName: string|null, sourceUrl: string|null } | null,
//   createdAt: number,
// }

const userIcons = [];
const listeners = [];

function notify() {
  const snapshot = list();
  for (const fn of listeners.slice()) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error("user-icon store listener threw:", err);
    }
  }
}

export function add(icon) {
  userIcons.push({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...icon,
  });
  notify();
}

export function remove(id) {
  const idx = userIcons.findIndex((i) => i.id === id);
  if (idx === -1) return;
  userIcons.splice(idx, 1);
  notify();
}

export function list() {
  return userIcons.slice();
}

export function replaceAll(next) {
  userIcons.length = 0;
  userIcons.push(...next);
  notify();
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
```

- [ ] **Step 4: Verify (no UI yet — just confirm the module loads cleanly)**

In the app's DevTools console:
```js
const ui = await import("./js/user-icons.js");
ui.add({ name: "test", tintable: true, fillSvg: "<svg/>", attribution: null });
console.log(ui.list()); // expect 1 entry with id + createdAt
ui.remove(ui.list()[0].id);
console.log(ui.list()); // expect []
```

No console errors. The store is not yet hydrated from localStorage — that happens in Task 3.

- [ ] **Step 5: Commit**

```bash
git add js/user-icons.js js/storage.js
git commit -m "feat(user-icons): add localStorage-backed user-icon store

Pub/sub mirror of pins.js. Adds USER_ICONS_KEY storage key,
attachUserIconStorage hydrate-then-subscribe helper. No consumers
yet — wired into the icon registry in the next task."
```

---

## Task 3: App bootstrap — hydrate user-icons before subscribers

**Files:**
- Modify: `js/app.js`

Hydration order matters: subscribers must be attached AFTER hydrate or the first store tick will overwrite good data with `[]`. Storage.js already documents this for pins/groups.

- [ ] **Step 1: In `js/app.js`, add the import alongside the other store imports (around line 17):**

```js
import * as userIconStore from "./user-icons.js";
```

And add the storage helper to the existing storage import (around line 18-31):

```js
import {
  attachStorage,
  attachGroupStorage,
  attachUserIconStorage,    // <-- add
  loadMapStyle,
  // … rest unchanged
} from "./storage.js";
```

- [ ] **Step 2: In `init()`, after `attachGroupStorage(groupStore);` (line 94), add:**

```js
  // Hydrate user-icon library BEFORE the icon registry subscribes to it,
  // so the very first registry-render reflects persisted custom icons.
  // Same hydrate-then-subscribe contract as attachStorage / attachGroupStorage.
  attachUserIconStorage(userIconStore);
```

- [ ] **Step 3: Verify in browser**
  1. Reload the app.
  2. DevTools console: `localStorage.setItem("city-pin-map.user-icons.v1", JSON.stringify([{id:"x",name:"seed",tintable:true,fillSvg:"<svg/>",attribution:null,createdAt:Date.now()}]))`
  3. Reload again.
  4. Console: `(await import("./js/user-icons.js")).list()` → expect `[{id:"x", name:"seed", …}]`.
  5. Cleanup: `localStorage.removeItem("city-pin-map.user-icons.v1")` and reload.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(bootstrap): hydrate user-icon store before subscribers"
```

---

## Task 4: Icon registry module (`js/icons.js`)

**Files:**
- Create: `js/icons.js`
- Modify: `js/map.js` (re-export from icons.js for backwards compat)
- Modify: `js/pin-list.js` (import path swap)

Extracts the icon registry out of `map.js` so the user-icon merge has a clean home and the registry can be subscribed to independently from the map. Adds `category` and `tintable` fields to existing icons.

- [ ] **Step 1: Create `js/icons.js`:**

```js
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
//   svg?: string,                                              // inline SVG string — user icons only (loaded from user-icons store)
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
  // Default — the migration target for pre-PI-001 pins. Sits alone in the picker.
  { id: "map-pin",  label: "Drop pin",  category: "default",  tintable: true, src: "assets/icons/map-pin.svg" },

  // Pins — geometric variants
  { id: "circle",   label: "Circle",    category: "pins",     tintable: true, src: "assets/icons/circle.svg" },
  { id: "star",     label: "Star",      category: "pins",     tintable: true, src: "assets/icons/star.svg" },
  { id: "heart",    label: "Heart",     category: "pins",     tintable: true, src: "assets/icons/heart.svg" },
  { id: "flag",     label: "Flag",      category: "pins",     tintable: true, src: "assets/icons/flag.svg" },

  // Places
  { id: "house",    label: "House",     category: "places",   tintable: true, src: "assets/icons/house.svg" },

  // Task 8 adds the remaining ~20 starter icons across travel/places/transport/markers.
];

export const DEFAULT_ICON_ID = "map-pin";

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
```

- [ ] **Step 2: In `js/map.js`, replace the inline PIN_ICONS / DEFAULT_PIN_ICON / PIN_ICON_IDS / effectiveIcon block (lines 363-373 + lines 749-752) with:**

```js
import {
  getMergedIcons,
  getIcon,
  subscribe as subscribeIcons,
  effectiveIcon as effectiveIconFromRegistry,
  DEFAULT_ICON_ID,
} from "./icons.js";

// ... (other existing imports stay)

const PIN_ICON_IMAGE_PREFIX = "city-pin-map.icon.";

// Re-export so existing callers (pin-list, future icon-picker) keep working.
export const DEFAULT_PIN_ICON = DEFAULT_ICON_ID;
export function effectiveIcon(pin) {
  return effectiveIconFromRegistry(pin);
}
// PIN_ICONS becomes a getter so any caller iterating it sees the merged
// (built-in + user) list. Existing PI-001 callers used it as a static array;
// they iterate-and-render once, so getMergedIcons() returning a snapshot is
// behavior-preserving for them. The icon-picker (Task 11) subscribes for
// live updates instead of polling.
export function getPinIcons() {
  return getMergedIcons();
}
// Backwards-compat for any reader still doing `PIN_ICONS.map(...)`. Shadows
// the old const at module scope without forcing an immediate sweep.
export const PIN_ICONS = new Proxy([], {
  get(target, prop) {
    const live = getMergedIcons();
    return Reflect.get(live, prop, live);
  },
});
```

Then **delete** the original `effectiveIcon` function body at lines 749-752 — it's now exported above.

- [ ] **Step 3: In `js/pin-list.js`, change the import on line 24-28 from:**

```js
import {
  effectiveColor,
  effectiveIcon,
  PIN_ICONS,
} from "./map.js";
```

to:

```js
import { effectiveColor } from "./map.js";
import { effectiveIcon, getMergedIcons } from "./icons.js";
```

And update `buildPopoverContent` (around line 380) — replace `for (const icon of PIN_ICONS)` with `for (const icon of getMergedIcons())`. Also update `loadIconTemplates` (around line 246) to read `getMergedIcons()` instead of `PIN_ICONS`. (This module is going to be largely rewritten in Task 12 anyway, but keep it functional in the meantime.)

- [ ] **Step 4: Verify in browser**
  1. Reload. The map should still render — markers, popover icon grid, color tint, drag, all unchanged from PI-001.
  2. DevTools console: `(await import("./js/icons.js")).getMergedIcons()` → expect 6 entries with new `category` + `tintable` fields, all `tintable: true`.
  3. Add a fake user icon: `(await import("./js/user-icons.js")).add({ name: "fake", tintable: true, fillSvg: "<svg width='24' height='24' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='6' fill='black'/></svg>", attribution: null })`
  4. `(await import("./js/icons.js")).getMergedIcons()` → expect 7 entries, last one `category: "user"`.
  5. The map won't yet register the new icon's MapLibre image (Task 7 wires the subscription). The popover may show a broken tile for it — also wired in Task 11.
  6. Cleanup: `(await import("./js/user-icons.js")).remove(/* the fake icon id */)`. Reload.

- [ ] **Step 5: Commit**

```bash
git add js/icons.js js/map.js js/pin-list.js
git commit -m "refactor(icons): extract icon registry from map.js to icons.js

Adds category and tintable fields to each entry. Introduces
getMergedIcons() / subscribe() so user-supplied icons (next task)
can join the same registry without map.js cracking open the user-
icon store directly. PIN_ICONS becomes a Proxy for backwards-compat
with any caller still iterating it as an array."
```

---

## Task 5: Map.js — subscribe to icon-registry changes

**Files:**
- Modify: `js/map.js`

Right now `loadPinIconImages` is called once and cached. When the user adds a custom icon, we need to (a) load its image, (b) `addImage` it under the prefixed sprite id, (c) re-render the source so the new pin can reference it without a layer rebuild.

- [ ] **Step 1: In `js/map.js`, replace `loadPinIconImages` (lines 806-814) and `fetchImage` (lines 816-824) with:**

```js
// Cached pin-sprite Image objects, keyed by icon id. setStyle() wipes
// MapLibre's image registry on every basemap swap, but the underlying
// HTMLImageElement is reusable — load once, re-register on every styledata
// via addImage. User icons (from icons.js, with inline `svg` strings)
// load via data: URLs so there's no network round-trip; built-ins use
// their `src` path under assets/icons/ and the browser HTTP-caches them.
const pinIconImages = new Map();

async function loadPinIconImages(targetIcons) {
  const missing = targetIcons.filter((icon) => !pinIconImages.has(icon.id));
  if (missing.length === 0) return;
  await Promise.all(
    missing.map((icon) =>
      fetchImage(iconImageHref(icon)).then((img) =>
        pinIconImages.set(icon.id, img)
      )
    )
  );
}

function iconImageHref(icon) {
  if (icon.svg) {
    // Inline SVG string from a user icon. data: URLs work as Image() src.
    // encodeURIComponent over `#` and friends keeps malformed-looking
    // shapes out of the browser's URL parser.
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(icon.svg);
  }
  return icon.src;
}

function fetchImage(href) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`Failed to load pin sprite "${href.slice(0, 80)}"`));
    img.src = href;
  });
}
```

- [ ] **Step 2: Update `addPinAndRouteLayers` to take the merged registry as input. Around line 833, replace:**

```js
  try {
    await loadPinIconImages();
  } catch (err) {
    showError(`${err.message}. Markers will not render.`);
    return;
  }
  // Defensive against a teardown that snuck in during the await.
  if (!mapInstance) return;

  for (const icon of PIN_ICONS) {
    const imageId = PIN_ICON_IMAGE_PREFIX + icon.id;
    if (!mapInstance.hasImage(imageId)) {
      mapInstance.addImage(imageId, pinIconImages.get(icon.id), {
        sdf: true,
        pixelRatio: 4,
      });
    }
  }
```

with:

```js
  const icons = getMergedIcons();
  try {
    await loadPinIconImages(icons);
  } catch (err) {
    showError(`${err.message}. Markers will not render.`);
    return;
  }
  if (!mapInstance) return;

  for (const icon of icons) {
    const imageId = PIN_ICON_IMAGE_PREFIX + icon.id;
    if (!mapInstance.hasImage(imageId)) {
      mapInstance.addImage(imageId, pinIconImages.get(icon.id), {
        sdf: icon.tintable,
        pixelRatio: 4,
      });
    }
  }
```

Note `sdf: icon.tintable` (was hardcoded `true`). Tintable user icons get SDF; non-tintable ones get raster RGBA.

- [ ] **Step 3: Add an icon-registry subscription so user-icon adds propagate to MapLibre. Right after `mapInstance.on("styledata", …)` block (around line 441):**

```js
  // Icon-registry subscription. When the user adds a custom icon, register
  // its MapLibre image and rebuild the source so any pin already using its
  // id renders correctly. Removing an icon doesn't need an explicit
  // mapInstance.removeImage call — the icon is gone from the registry, and
  // its image just goes unreferenced. The next styledata cycle drops it
  // (setStyle wipes the registry; the missing icon won't be re-added).
  subscribeIcons(async (mergedIcons) => {
    if (!mapInstance) return;
    try {
      await loadPinIconImages(mergedIcons);
    } catch (err) {
      showError(`${err.message}. Custom icon may not render.`);
      return;
    }
    for (const icon of mergedIcons) {
      const imageId = PIN_ICON_IMAGE_PREFIX + icon.id;
      if (!mapInstance.hasImage(imageId)) {
        mapInstance.addImage(imageId, pinIconImages.get(icon.id), {
          sdf: icon.tintable,
          pixelRatio: 4,
        });
      }
    }
    // Re-render markers so any pin that just got a newly-available icon
    // picks it up. Cheap (full-source replace at this app's scale).
    const source = mapInstance.getSource(PINS_SOURCE_ID);
    if (source) source.setData(pinsToFeatureCollection(lastPinsSnapshot));
  });
```

- [ ] **Step 4: Verify in browser**
  1. Reload. Existing markers should render unchanged (still 6 built-in icons, all tintable).
  2. Console: `(await import("./js/user-icons.js")).add({ name: "test-circle", tintable: true, fillSvg: "<svg width='128' height='128' xmlns='http://www.w3.org/2000/svg'><circle cx='64' cy='100' r='40' fill='black'/></svg>", attribution: null })`. Note: this won't visually show until a pin uses it (Task 13 lets users pick custom icons), but the registration should happen silently.
  3. Console: `getMap().hasImage("city-pin-map.icon." + (await import("./js/user-icons.js")).list()[0].id)` → expect `true`.
  4. Cleanup: remove the user icon as before.

- [ ] **Step 5: Commit**

```bash
git add js/map.js
git commit -m "feat(map): subscribe to icon registry and register user icons

User icons load via data: URLs (no network round-trip) and register as
SDF or raster based on the icon's tintable flag. The subscription
re-renders markers after each registry change so pins referencing a
just-added icon paint immediately."
```

---

## Task 6: Materialize `tintable` in pinsToFeatureCollection

**Files:**
- Modify: `js/map.js`

The color-ring layer (Task 7) needs `tintable` as a feature property so its filter expression can gate on it.

- [ ] **Step 1: Replace `pinsToFeatureCollection` (lines 778-792) with:**

```js
function pinsToFeatureCollection(pins) {
  return {
    type: "FeatureCollection",
    features: pins.map((pin) => {
      const iconId = effectiveIcon(pin);
      const iconEntry = getIcon(iconId);
      // tintable defaults to true so pre-registry-load pins still render
      // sensibly. The default-pin built-in is always tintable, so this is
      // the conservative fallback.
      const tintable = iconEntry?.tintable ?? true;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [pin.lon, pin.lat] },
        properties: {
          id: pin.id,
          name: pin.name,
          color: effectiveColor(pin),
          icon: iconId,
          tintable,
        },
      };
    }),
  };
}
```

- [ ] **Step 2: Verify in browser**
  1. Reload.
  2. Console: `getMap().getSource("city-pin-map.pins")._data.features[0].properties` → expect `{ id, name, color, icon, tintable: true }`.
  3. Map renders unchanged (the new property is just metadata; no layer reads it yet).

- [ ] **Step 3: Commit**

```bash
git add js/map.js
git commit -m "feat(map): materialize tintable property in pin features"
```

---

## Task 7: Color-ring layer for non-tintable icons

**Files:**
- Modify: `js/map.js`

Add a `circle`-type layer beneath `pins-fill`, filtered to features where `tintable: false`. The ring shows group/pin color underneath full-color custom icons.

- [ ] **Step 1: In `js/map.js`, add the layer-id const near the others (around line 341):**

```js
const PINS_COLOR_RING_LAYER_ID = "city-pin-map.pins-color-ring";
```

- [ ] **Step 2: In `addPinAndRouteLayers`, before the existing `if (!mapInstance.getLayer(PINS_LAYER_ID))` block (around line 902), add:**

```js
  // Color ring for non-tintable icons (full-color custom uploads). The
  // pins-fill layer's icon-color paint is silently ignored on non-SDF
  // sprites, so without a separate color cue, group color and per-pin
  // color would never read on those pins. The ring sits slightly above
  // the icon's bottom anchor so it peeks out from the base of the marker.
  // Filtered to features with tintable=false; tintable pins draw their
  // color via icon-color and don't need the ring.
  if (!mapInstance.getLayer(PINS_COLOR_RING_LAYER_ID)) {
    mapInstance.addLayer({
      id: PINS_COLOR_RING_LAYER_ID,
      type: "circle",
      source: PINS_SOURCE_ID,
      filter: ["==", ["get", "tintable"], false],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": 6,
        "circle-translate": [0, -2],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });
  }
```

This block must come BEFORE the `pins-fill` add (so color-ring sits beneath fill in z-order) and BEFORE `pins-labels` (which the existing code adds last).

- [ ] **Step 3: Verify in browser**
  1. Reload. All existing pins are tintable, so the ring layer is silent (filter excludes them).
  2. Console: confirm the layer exists: `getMap().getLayer("city-pin-map.pins-color-ring")` → returns the layer object.
  3. Z-order check: `getMap().getStyle().layers.map(l=>l.id).filter(id=>id.startsWith("city-pin-map"))` → expect order `pins-color-ring`, `pins-fill`, `pins-labels` (color-ring underneath, labels on top, route-line is also there but unrelated).
  4. Cycle through 5 basemaps via the picker (e.g. OSM Liberty, Dark, Satellite Hybrid, Wikimedia, Stamen Watercolor). Markers persist correctly; no console errors about the new layer.

- [ ] **Step 4: Commit**

```bash
git add js/map.js
git commit -m "feat(map): add color-ring layer for non-tintable icons

Filtered to tintable=false features; renders nothing for the current
all-tintable starter set, but is the visibility contract for group/pin
color when users upload full-color custom icons (next milestone)."
```

---

## Task 8: Expand starter set — ~20 more SVGs across 5 categories

**Files:**
- Create: `assets/icons/<id>.svg` (~20 new files)
- Modify: `js/icons.js`

Spec target: total ~26 icons across 6 categories. PI-001 shipped 6 (one in `default`, four in `pins`, one in `places`). This task adds ~20 more.

**Source strategy:** prefer Heroicons solid (24-grid, MIT, by Tailwind) — same family as PI-001's existing icons, so visual weight stays consistent. Fall back to Tabler `filled` for shapes Heroicons doesn't have. Each new SVG must be a **single-color filled silhouette** (so SDF tinting works), authored at a 128×128 outer size with the source library's native viewBox.

**Per-icon ingest steps:** For each icon below: (a) download the SVG from the source library's repo or website, (b) ensure it's a single-color silhouette (modify if not), (c) set `width="128" height="128"` on the outer `<svg>` while keeping the native viewBox, (d) add a 5-line header comment with the upstream URL + MIT attribution, (e) save to `assets/icons/<id>.svg`.

Target additions (final list — exact source picks at implementer's discretion provided each is a filled MIT-licensed silhouette):

| Category | id | label | Suggested source |
|---|---|---|---|
| pins | `square` | Square | Heroicons solid (build from rectangle-stack or hand-author 8px-radius rounded square) |
| pins | `hexagon` | Hexagon | Tabler filled `hexagon-filled` |
| travel | `plane` | Airplane | Heroicons solid `paper-airplane` (or Tabler `plane-filled`) |
| travel | `hotel` | Hotel | Heroicons solid `building-office-2` |
| travel | `restaurant` | Restaurant | Heroicons solid `cake` (or hand-author fork+knife) |
| travel | `coffee` | Coffee | Tabler filled `coffee-filled` |
| travel | `camera` | Camera | Heroicons solid `camera` |
| travel | `suitcase` | Suitcase | Heroicons solid `briefcase` |
| places | `building` | Building | Heroicons solid `building-office` |
| places | `mountain` | Mountain | Tabler filled `mountain-filled` (or hand-author) |
| places | `tree` | Tree | Heroicons solid `cube` (NB: Heroicons lacks a tree; hand-author or use Phosphor `tree-fill`) |
| places | `hospital` | Hospital | Heroicons solid `plus-circle` (modify) or Tabler `hospital-filled` |
| transport | `car` | Car | Heroicons solid `truck` (modify) or Tabler `car-filled` |
| transport | `bus` | Bus | Tabler `bus-filled` |
| transport | `train` | Train | Tabler `train-filled` |
| transport | `bike` | Bike | Tabler `bike-filled` |
| markers | `check` | Checkmark | Heroicons solid `check-circle` |
| markers | `exclamation` | Exclamation | Heroicons solid `exclamation-circle` |
| markers | `question` | Question | Heroicons solid `question-mark-circle` |
| markers | `info` | Info | Heroicons solid `information-circle` |

That's 20 new icons. Combined with PI-001's 6, total is 26.

- [ ] **Step 1: Create all 20 SVG files in `assets/icons/`. Each file follows this pattern:**

```xml
<!--
  <id>.svg
  Source: <upstream URL>
  License: MIT — © <year> <copyright holder>
  Notes: any modifications (e.g. "stroke→fill conversion", "reduced detail for marker scale")
-->
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="currentColor">
  <!-- the path data, single-color black -->
  <path d="..."/>
</svg>
```

- [ ] **Step 2: In `js/icons.js`, append to the `BUILTIN_ICONS` array (preserving the existing 6 entries):**

```js
  // pins (continued)
  { id: "square",      label: "Square",      category: "pins",      tintable: true, src: "assets/icons/square.svg" },
  { id: "hexagon",     label: "Hexagon",     category: "pins",      tintable: true, src: "assets/icons/hexagon.svg" },

  // travel
  { id: "plane",       label: "Airplane",    category: "travel",    tintable: true, src: "assets/icons/plane.svg" },
  { id: "hotel",       label: "Hotel",       category: "travel",    tintable: true, src: "assets/icons/hotel.svg" },
  { id: "restaurant",  label: "Restaurant",  category: "travel",    tintable: true, src: "assets/icons/restaurant.svg" },
  { id: "coffee",      label: "Coffee",      category: "travel",    tintable: true, src: "assets/icons/coffee.svg" },
  { id: "camera",      label: "Camera",      category: "travel",    tintable: true, src: "assets/icons/camera.svg" },
  { id: "suitcase",    label: "Suitcase",    category: "travel",    tintable: true, src: "assets/icons/suitcase.svg" },

  // places (continued)
  { id: "building",    label: "Building",    category: "places",    tintable: true, src: "assets/icons/building.svg" },
  { id: "mountain",    label: "Mountain",    category: "places",    tintable: true, src: "assets/icons/mountain.svg" },
  { id: "tree",        label: "Tree",        category: "places",    tintable: true, src: "assets/icons/tree.svg" },
  { id: "hospital",    label: "Hospital",    category: "places",    tintable: true, src: "assets/icons/hospital.svg" },

  // transport
  { id: "car",         label: "Car",         category: "transport", tintable: true, src: "assets/icons/car.svg" },
  { id: "bus",         label: "Bus",         category: "transport", tintable: true, src: "assets/icons/bus.svg" },
  { id: "train",       label: "Train",       category: "transport", tintable: true, src: "assets/icons/train.svg" },
  { id: "bike",        label: "Bike",        category: "transport", tintable: true, src: "assets/icons/bike.svg" },

  // markers
  { id: "check",       label: "Checkmark",   category: "markers",   tintable: true, src: "assets/icons/check.svg" },
  { id: "exclamation", label: "Exclamation", category: "markers",   tintable: true, src: "assets/icons/exclamation.svg" },
  { id: "question",    label: "Question",    category: "markers",   tintable: true, src: "assets/icons/question.svg" },
  { id: "info",        label: "Info",        category: "markers",   tintable: true, src: "assets/icons/info.svg" },
```

- [ ] **Step 3: Verify in browser**
  1. Reload.
  2. Open the existing PI-001 popover from a pin row's appearance tile. The 2×3 grid expands to fit all 26 icons (it'll wrap or scroll — that's fine; Task 11 replaces the popover with a categorized modal).
  3. Click each new icon for a pin; verify the marker renders the chosen shape.
  4. Refresh; verify persistence.
  5. Console: `getMergedIcons().length` → 26.
  6. Console: `getMap().hasImage("city-pin-map.icon.plane")` → `true`.

- [ ] **Step 4: Commit**

```bash
git add assets/icons/ js/icons.js
git commit -m "feat(icons): add 20 starter icons across 5 categories

Brings the starter set to 26 icons (1 default + 6 pins + 6 travel +
5 places + 4 transport + 4 markers). All MIT-licensed silhouettes
from Heroicons solid + Tabler filled, normalized to 128×128 outer
size for SDF rasterization quality."
```

---

## Task 9: SVG ingest module + Node tests

**Files:**
- Create: `js/svg-ingest.js`
- Create: `js/svg-ingest.test.mjs`

Pure-logic module: sanitize untrusted SVG markup, normalize viewBox, derive a tintable heuristic. Used by the add-icon sub-flow (Task 13) to safely accept arbitrary SVG from file-drop / textarea / Flaticon-downloads.

This is the only module in the codebase that genuinely benefits from automated unit tests — pure functions, security-critical (XSS), easy to run without browser context. Run with `node --test js/svg-ingest.test.mjs` (Node 18+, no install needed). The test runner is built in.

The production code uses the browser's `DOMParser`/`XMLSerializer` directly. The Node test exercises the policy logic (allowlists, fill counting) against tree-shaped mocks — pure functions like `walk(el, violations)` and `collectFills(svg)` get full coverage. The browser-only parser layer is verified manually in Task 13's verification steps.

- [ ] **Step 1: Create `js/svg-ingest.js`:**

```js
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

const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "polygon", "polyline", "ellipse",
  "line", "defs", "clipPath", "mask", "linearGradient", "radialGradient",
  "stop", "title", "desc",
]);

const ALLOWED_ATTRS = new Set([
  // Geometry
  "d", "cx", "cy", "r", "x", "y", "x1", "y1", "x2", "y2",
  "width", "height", "rx", "ry", "points",
  // Paint
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "opacity",
  // Transform / refs
  "transform", "viewBox", "preserveAspectRatio",
  // Gradient stops
  "offset", "stop-color", "stop-opacity",
  "gradientUnits", "gradientTransform",
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
```

- [ ] **Step 2: Create `js/svg-ingest.test.mjs`:**

```js
// Run with: node --test js/svg-ingest.test.mjs
//
// Covers the policy logic (allowlists, fill counting). Browser-only
// DOMParser/XMLSerializer paths are verified manually in Task 13.

import { test } from "node:test";
import assert from "node:assert/strict";
import { walk, collectFills } from "./svg-ingest.js";

// Minimal element shim that mimics the browser API surface our walker
// touches. Keeps tests dependency-free.
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
```

- [ ] **Step 3: Run tests**

```bash
node --test js/svg-ingest.test.mjs
```

Expected output: 10 tests pass.

- [ ] **Step 4: Verify the production module loads in the browser**

In DevTools console:
```js
const m = await import("./js/svg-ingest.js");
m.ingestSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L10 10" fill="black"/></svg>')
// → { ok: true, sanitizedSvg: "<svg…", suggestedTintable: true }

m.ingestSvg('<svg><script>alert(1)</script></svg>')
// → { ok: false, error: "SVG contains content that can't be safely imported: <script>." }
```

- [ ] **Step 5: Commit**

```bash
git add js/svg-ingest.js js/svg-ingest.test.mjs
git commit -m "feat(svg-ingest): pure SVG sanitization module

Allowlist-based: rejects anything outside known-safe tags/attrs.
XSS surface covered: <script>, <foreignObject>, on* handlers,
javascript: hrefs. Normalizes outer viewBox + width/height for
SDF rasterization at 128×128. Tintable heuristic counts unique
fills; ≤1 → suggest tintable=true.

Tests run via Node built-in test runner (node --test), no
dependencies."
```

---

## Task 10: CSS scaffolding for the icon-picker modal

**Files:**
- Modify: `css/styles.css`

Adds modal overlay styles. Keeps the popover styles in place for now — Task 12 deletes them once the modal trigger is wired.

- [ ] **Step 1: Append to `css/styles.css`:**

```css
/* ---- Icon picker modal (PIL-001) -------------------------------------- */

.icon-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.icon-picker-modal {
  background: #ffffff;
  border-radius: 8px;
  width: min(560px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.icon-picker-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e5e5;
  font-weight: 600;
}

.icon-picker-modal__close {
  background: none;
  border: 0;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
}

.icon-picker-modal__search {
  padding: 8px 16px;
  border-bottom: 1px solid #e5e5e5;
}

.icon-picker-modal__search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font: inherit;
}

.icon-picker-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.icon-picker-modal__category {
  margin-bottom: 16px;
}

.icon-picker-modal__category-title {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.icon-picker-modal__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 8px;
}

.icon-picker-modal__tile {
  position: relative;
  background: #f5f5f5;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  transition: background 0.1s, border-color 0.1s;
}

.icon-picker-modal__tile:hover {
  background: #ececec;
}

.icon-picker-modal__tile--selected {
  border-color: currentColor;
  background: #ffffff;
}

.icon-picker-modal__tile-icon svg,
.icon-picker-modal__tile-icon img {
  width: 32px;
  height: 32px;
  display: block;
}

.icon-picker-modal__tile-trash {
  position: absolute;
  top: 2px;
  right: 2px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 3px;
  width: 18px;
  height: 18px;
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.icon-picker-modal__tile:hover .icon-picker-modal__tile-trash {
  display: flex;
}

.icon-picker-modal__add-tile {
  background: transparent;
  border: 2px dashed #aaa;
  color: #666;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border-radius: 6px;
}

.icon-picker-modal__footer {
  border-top: 1px solid #e5e5e5;
  padding: 10px 16px;
  font-size: 12px;
  color: #666;
}

/* Add-icon sub-view (replaces the grid in the same modal frame) */
.icon-picker-modal__sub {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.icon-picker-modal__sub-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.icon-picker-modal__field {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.icon-picker-modal__field label {
  font-size: 12px;
  font-weight: 600;
  color: #444;
}

.icon-picker-modal__field input,
.icon-picker-modal__field textarea {
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font: inherit;
}

.icon-picker-modal__hint {
  font-size: 11px;
  color: #888;
}

.icon-picker-modal__drop-zone {
  border: 2px dashed #aaa;
  border-radius: 4px;
  padding: 20px;
  text-align: center;
  color: #666;
}

.icon-picker-modal__drop-zone--active {
  border-color: #1d3557;
  background: #f0f4f8;
}

.icon-picker-modal__or {
  text-align: center;
  font-size: 12px;
  color: #888;
  margin: 6px 0;
}

.icon-picker-modal__preview-row {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid #e5e5e5;
  margin-top: 8px;
}

.icon-picker-modal__preview-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.icon-picker-modal__preview-label {
  font-size: 12px;
  color: #666;
}

.icon-picker-modal__preview {
  width: 64px;
  height: 64px;
  background: #f5f5f5;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-picker-modal__preview img,
.icon-picker-modal__preview svg {
  width: 48px;
  height: 48px;
}

.icon-picker-modal__radio-group label {
  display: block;
  font-weight: normal;
  margin: 4px 0;
}

.icon-picker-modal__recommend {
  color: #888;
  font-size: 12px;
}

.icon-picker-modal__recommend--hidden {
  display: none;
}

.icon-picker-modal__error {
  color: #c0392b;
  font-size: 13px;
  margin-top: 8px;
}

.icon-picker-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e5e5e5;
}
```

- [ ] **Step 2: Verify**
  1. Reload. No visual change yet (modal isn't mounted). Just confirm no CSS parse errors in DevTools Console.
  2. Verify the existing popover still works.

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "feat(css): icon-picker modal styles"
```

---

## Task 11: Icon picker modal — grid view

**Files:**
- Create: `js/icon-picker.js`

Pure renderer: takes a pin id, mounts a modal overlay, shows a categorized grid + search + footer attribution. Picking writes `pin.icon` and closes the modal. No add-icon sub-view yet (Task 13).

- [ ] **Step 1: Create `js/icon-picker.js`:**

```js
// Modal icon picker. Replaces PI-001's popover with a richer surface that
// hosts: (a) a categorized icon grid with search, (b) the add-icon
// sub-flow (Task 13), (c) per-user-icon delete + attribution display.
//
// API:
//   openIconPicker(pinId) → mounts the modal, scoped to the given pin.
//                           Closes on ESC, click-outside, or icon-pick.
//   closeIconPicker()    → idempotent.
//
// State is module-singleton (only one open at a time); reopening for a
// different pin closes the prior instance first.

import { listPins, updatePin } from "./pins.js";
import {
  getMergedIcons,
  subscribe as subscribeIcons,
  effectiveIcon,
} from "./icons.js";
import * as userIconStore from "./user-icons.js";

const CATEGORY_ORDER = ["default", "pins", "travel", "places", "transport", "markers", "user"];
const CATEGORY_LABEL = {
  default: "Default",
  pins: "Pins",
  travel: "Travel",
  places: "Places",
  transport: "Transport",
  markers: "Markers",
  user: "My icons",
};

let activeState = null;

export function openIconPicker(pinId) {
  closeIconPicker();

  const overlay = document.createElement("div");
  overlay.className = "icon-picker-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "icon-picker-modal";
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const renderGrid = () => {
    const livePin = listPins().find((p) => p.id === pinId);
    if (!livePin) {
      closeIconPicker();
      return;
    }
    modal.replaceChildren(...buildGridView(livePin, modal));
  };
  renderGrid();

  // Re-render when icons change (user-icon add/delete).
  const unsubIcons = subscribeIcons(renderGrid);

  const onClickOutside = (e) => {
    if (e.target === overlay) closeIconPicker();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closeIconPicker();
  };
  overlay.addEventListener("click", onClickOutside);
  document.addEventListener("keydown", onKey);

  activeState = {
    pinId,
    overlay,
    modal,
    teardown: () => {
      unsubIcons();
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    },
  };
}

export function closeIconPicker() {
  if (!activeState) return;
  activeState.teardown();
  activeState = null;
}

// Helper: caller from the sub-view to return to the grid.
export function showGridView(modal, pinId) {
  const livePin = listPins().find((p) => p.id === pinId);
  if (!livePin) {
    closeIconPicker();
    return;
  }
  modal.replaceChildren(...buildGridView(livePin, modal));
}

function buildGridView(pin, modal) {
  const nodes = [];

  const header = document.createElement("div");
  header.className = "icon-picker-modal__header";
  const title = document.createElement("span");
  title.textContent = "Pin icon";
  header.appendChild(title);
  const close = document.createElement("button");
  close.className = "icon-picker-modal__close";
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", closeIconPicker);
  header.appendChild(close);
  nodes.push(header);

  const searchWrap = document.createElement("div");
  searchWrap.className = "icon-picker-modal__search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search icons…";
  searchInput.className = "icon-picker-modal__search-input";
  searchWrap.appendChild(searchInput);
  nodes.push(searchWrap);

  const body = document.createElement("div");
  body.className = "icon-picker-modal__body";
  nodes.push(body);

  const drawBody = (query) => {
    body.replaceChildren();
    const merged = getMergedIcons();
    const filtered = query
      ? merged.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
      : merged;
    const byCategory = new Map();
    for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);
    for (const icon of filtered) {
      const arr = byCategory.get(icon.category) || [];
      arr.push(icon);
      byCategory.set(icon.category, arr);
    }
    for (const cat of CATEGORY_ORDER) {
      const items = byCategory.get(cat) || [];
      if (items.length === 0 && cat !== "user") continue;
      body.appendChild(buildCategorySection(pin, cat, items, modal));
    }
  };

  searchInput.addEventListener("input", () => drawBody(searchInput.value));
  drawBody("");

  const footer = document.createElement("div");
  footer.className = "icon-picker-modal__footer";
  footer.textContent =
    "Custom icons may include third-party artwork. Hover an icon for credit.";
  nodes.push(footer);

  return nodes;
}

function buildCategorySection(pin, category, icons, modal) {
  const section = document.createElement("div");
  section.className = "icon-picker-modal__category";

  const titleRow = document.createElement("div");
  titleRow.className = "icon-picker-modal__category-title";
  const titleSpan = document.createElement("span");
  titleSpan.textContent = CATEGORY_LABEL[category] || category;
  titleRow.appendChild(titleSpan);

  if (category === "user") {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ Add";
    addBtn.style.cssText =
      "background: none; border: 0; cursor: pointer; color: #1d3557; font-weight: 600;";
    addBtn.addEventListener("click", () => showAddSubView(pin, modal));
    titleRow.appendChild(addBtn);
  }
  section.appendChild(titleRow);

  const grid = document.createElement("div");
  grid.className = "icon-picker-modal__grid";
  for (const icon of icons) {
    grid.appendChild(buildTile(pin, icon));
  }
  if (category === "user") {
    grid.appendChild(buildAddTile(pin, modal));
  }
  section.appendChild(grid);
  return section;
}

function buildTile(pin, icon) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "icon-picker-modal__tile";
  tile.style.color = pin.color;

  const iconEl = document.createElement("span");
  iconEl.className = "icon-picker-modal__tile-icon";
  iconEl.appendChild(buildIconNode(icon));
  tile.appendChild(iconEl);

  const isSelected = effectiveIcon(pin) === icon.id;
  if (isSelected) {
    tile.classList.add("icon-picker-modal__tile--selected");
  }

  // Tooltip with attribution for user icons.
  if (icon.category === "user") {
    const credit = formatCredit(icon);
    tile.title = credit;
    // Trash button for delete + cascade-clear.
    const trash = document.createElement("span");
    trash.className = "icon-picker-modal__tile-trash";
    trash.textContent = "🗑";
    trash.setAttribute("role", "button");
    trash.setAttribute("aria-label", `Delete ${icon.label}`);
    trash.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${icon.label}"? Pins using it will reset to the default icon.`)) return;
      // Cascade-clear: any pin currently using this user icon falls back
      // to default. effectiveIcon already handles the orphan case
      // gracefully, but clearing the field keeps storage clean.
      for (const p of listPins()) {
        if (p.icon === icon.id) updatePin(p.id, { icon: null });
      }
      userIconStore.remove(icon.id);
    });
    tile.appendChild(trash);
  } else {
    tile.title = icon.label;
  }

  tile.addEventListener("click", () => {
    if (!isSelected) updatePin(pin.id, { icon: icon.id });
    closeIconPicker();
  });
  return tile;
}

function buildAddTile(pin, modal) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "icon-picker-modal__add-tile";
  tile.textContent = "+ Add";
  tile.addEventListener("click", () => showAddSubView(pin, modal));
  return tile;
}

function formatCredit(icon) {
  const parts = [icon.label];
  if (icon.attribution?.artistName) parts.push(`by ${icon.attribution.artistName}`);
  if (icon.attribution?.sourceUrl) parts.push(icon.attribution.sourceUrl);
  return parts.join(" — ");
}

// Renders an SVG element from either a `src` URL (built-in) or an inline
// `svg` markup string (user icon). Both render via <img> for simplicity;
// the browser caches built-in src paths and decodes data: URLs natively.
function buildIconNode(icon) {
  const img = document.createElement("img");
  img.alt = icon.label;
  img.src = icon.svg
    ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(icon.svg)
    : icon.src;
  return img;
}

// showAddSubView is implemented in Task 13. Placeholder export so Task
// 11's commit compiles cleanly. Replace the body in Task 13.
export function showAddSubView(_pin, _modal) {
  console.info("Add-icon flow lands in Task 13.");
}
```

- [ ] **Step 2: Verify in browser (modal not yet wired to a trigger)**

Console:
```js
const ip = await import("./js/icon-picker.js");
const pin = (await import("./js/pins.js")).listPins()[0];
ip.openIconPicker(pin.id);
```

Expected: modal appears, categorized grid (Default + Pins + Places + Travel + Transport + Markers + My icons after Task 8 has run), search input filters live, clicking a tile updates the pin and closes the modal. ESC closes. Click on the dimmed backdrop closes.

- [ ] **Step 3: Commit**

```bash
git add js/icon-picker.js
git commit -m "feat(icon-picker): modal grid view with categories + search

Renders the merged registry as categorized sections, supports
search-by-name, click-to-pick. User-icon tiles show attribution
in their title attribute, a hover-reveal trash icon that
cascade-clears pin.icon on referenced pins, and there's a stub
showAddSubView ready for Task 13."
```

---

## Task 12: Switch the trigger from popover to modal

**Files:**
- Modify: `js/pin-list.js`
- Modify: `css/styles.css` (delete unused popover rules)

Replace the existing `openAppearancePopover` call site with `openIconPicker` from the new module. Delete the popover machinery (~230 lines from `pin-list.js`). Color editing moves to a small `<input type="color">` swatch sibling to the appearance tile, so the appearance tile can do one thing (open the icon modal) and the swatch can do one thing (open the native color input).

- [ ] **Step 1: In `js/pin-list.js`, remove all popover-related code:**
  - Delete `iconTemplates`, `iconTemplatesPromise`, `svgParser`, `loadIconTemplates`, `buildIconElement` (lines 242-294).
  - Delete `popoverState`, `openAppearancePopover`, `closeAppearancePopover`, `buildPopoverContent`, `buildIconChoice`, `positionPopover` (lines 297-468).

- [ ] **Step 2: At the top of `js/pin-list.js`, replace the imports (lines 19-28) with:**

```js
import { subscribe, listPins, removePin, updatePin } from "./pins.js";
import {
  subscribe as subscribeGroups,
  listGroups,
} from "./groups.js";
import { effectiveColor } from "./map.js";
import { effectiveIcon, getIcon } from "./icons.js";
import { openIconPicker } from "./icon-picker.js";
```

- [ ] **Step 3: Replace `buildAppearanceTile` (lines 127-148) with:**

```js
function buildAppearanceTile(pin, iconId, color, groupAssigned) {
  // Compose two siblings: the icon tile (opens modal) + a tiny color
  // swatch (opens native color input). Wrapper keeps the layout tight.
  const wrapper = document.createElement("span");
  wrapper.className = "pin-list__appearance";

  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "pin-list__tile";
  tile.style.color = color;

  // Render the icon as <img> direct from the registry. For built-ins this
  // is the file path; for user icons it's a data: URL inline.
  const iconEntry = getIcon(iconId);
  const iconImg = document.createElement("img");
  iconImg.alt = iconEntry?.label || iconId;
  iconImg.src = iconEntry?.svg
    ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(iconEntry.svg)
    : iconEntry?.src || "";
  iconImg.style.cssText = "width:18px;height:18px;display:block;";
  tile.appendChild(iconImg);

  if (groupAssigned) {
    tile.classList.add("pin-list__tile--readonly");
    tile.disabled = true;
    tile.setAttribute(
      "aria-label",
      `Appearance is controlled by group ${groupAssigned.name}`
    );
    wrapper.appendChild(tile);
    return wrapper;
  }

  tile.setAttribute("aria-label", `Change icon of pin ${pin.name}`);
  tile.setAttribute("aria-haspopup", "dialog");
  tile.addEventListener("click", () => openIconPicker(pin.id));
  wrapper.appendChild(tile);

  // Color swatch — small native color input. Sibling to the icon tile.
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "pin-list__color-swatch";
  colorInput.value = pin.color;
  colorInput.setAttribute("aria-label", `Change color of pin ${pin.name}`);
  colorInput.addEventListener("change", () => {
    updatePin(pin.id, { color: colorInput.value });
  });
  wrapper.appendChild(colorInput);

  return wrapper;
}
```

- [ ] **Step 4: In `css/styles.css`, add the wrapper + swatch styles (alongside the existing `.pin-list__tile`):**

```css
.pin-list__appearance {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pin-list__color-swatch {
  width: 20px;
  height: 20px;
  border: 1px solid #ccc;
  border-radius: 3px;
  padding: 0;
  background: none;
  cursor: pointer;
}
```

- [ ] **Step 5: In `css/styles.css`, delete every rule whose selector contains `.appearance-popover` (find via grep `grep -n "appearance-popover" css/styles.css`).**

- [ ] **Step 6: Verify in browser**
  1. Reload.
  2. Pin row now shows: appearance tile (icon) + color swatch + name + group select + edit + remove.
  3. Click the appearance tile — modal opens with the categorized grid.
  4. Pick an icon — marker on the map updates, modal closes.
  5. Click the color swatch — native color picker opens; pick a color; marker recolors.
  6. Group a pin — appearance tile becomes disabled (group color/icon takes over).
  7. ESC closes the modal; click-outside (on the dimmed backdrop) closes it.

- [ ] **Step 7: Commit**

```bash
git add js/pin-list.js css/styles.css
git commit -m "feat(pin-list): switch icon trigger from popover to modal

Pin row now shows two affordances side-by-side: the appearance tile
opens the icon-picker modal, and a small color swatch opens the
native color input. Removes ~230 lines of popover machinery from
pin-list.js — that responsibility now lives in icon-picker.js."
```

---

## Task 13: Add-icon sub-view

**Files:**
- Modify: `js/icon-picker.js`

Wire the `showAddSubView` placeholder from Task 11 to a real implementation that takes file/textarea/URL inputs, runs them through `svg-ingest`, shows live previews, and commits to `userIconStore.add`. All DOM construction uses `createElement` + property assignment — no `innerHTML`, no template strings written to the DOM.

- [ ] **Step 1: In `js/icon-picker.js`, add the import at the top:**

```js
import { ingestSvg } from "./svg-ingest.js";
```

- [ ] **Step 2: In `js/icon-picker.js`, replace the placeholder `showAddSubView` (the last function, currently a `console.info` stub) with this complete implementation:**

```js
// Tracks the in-flight ingest result so the form's tintable radio + commit
// button can read sanitized markup without re-parsing.
let pendingIngest = null;

export function showAddSubView(pin, modal) {
  pendingIngest = null;

  const sub = document.createElement("div");
  sub.className = "icon-picker-modal__sub";

  // Header with Back button.
  const header = document.createElement("div");
  header.className = "icon-picker-modal__header";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "icon-picker-modal__close";
  back.textContent = "← Back";
  back.addEventListener("click", () => showGridView(modal, pin.id));
  header.appendChild(back);

  const titleSpan = document.createElement("span");
  titleSpan.textContent = "Add custom icon";
  header.appendChild(titleSpan);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-picker-modal__close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", closeIconPicker);
  header.appendChild(close);

  sub.appendChild(header);

  // Scrollable body.
  const body = document.createElement("div");
  body.className = "icon-picker-modal__sub-body";
  sub.appendChild(body);

  // Name field (required).
  const nameField = makeField("Name *", "text");
  body.appendChild(nameField.wrap);

  // SVG content: drop-zone + textarea.
  const svgFieldWrap = document.createElement("div");
  svgFieldWrap.className = "icon-picker-modal__field";

  const svgLabel = document.createElement("label");
  svgLabel.textContent = "SVG content *";
  svgFieldWrap.appendChild(svgLabel);

  const dropZone = document.createElement("div");
  dropZone.className = "icon-picker-modal__drop-zone";
  dropZone.textContent = "Drop SVG file here";
  svgFieldWrap.appendChild(dropZone);

  const orRow = document.createElement("div");
  orRow.className = "icon-picker-modal__or";
  orRow.textContent = "or paste SVG markup";
  svgFieldWrap.appendChild(orRow);

  const textarea = document.createElement("textarea");
  textarea.rows = 4;
  textarea.placeholder = "<svg ...>";
  svgFieldWrap.appendChild(textarea);

  body.appendChild(svgFieldWrap);

  // Source URL (attribution only, not fetched).
  const urlField = makeField(
    "Source URL (optional, for credit)",
    "url",
    "Source link only — not downloaded"
  );
  body.appendChild(urlField.wrap);

  // Artist name.
  const artistField = makeField("Artist name (optional)", "text");
  body.appendChild(artistField.wrap);

  // Preview row (tinted + as-is).
  const previewRow = document.createElement("div");
  previewRow.className = "icon-picker-modal__preview-row";

  const tintedCol = makePreviewColumn("Tinted", pin.color);
  const asIsCol = makePreviewColumn("As-is", null);

  previewRow.appendChild(tintedCol.wrap);
  previewRow.appendChild(asIsCol.wrap);
  body.appendChild(previewRow);

  // Tintable radio group.
  const radioGroup = makeTintableRadioGroup();
  body.appendChild(radioGroup.wrap);

  // Error display.
  const errorEl = document.createElement("div");
  errorEl.className = "icon-picker-modal__error";
  body.appendChild(errorEl);

  // Action buttons.
  const actions = document.createElement("div");
  actions.className = "icon-picker-modal__actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => showGridView(modal, pin.id));
  actions.appendChild(cancelBtn);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "Add to my icons";
  addBtn.disabled = true;
  addBtn.addEventListener("click", () => {
    if (!pendingIngest || !pendingIngest.ok) return;
    const meta = {
      name: nameField.input.value.trim(),
      sourceUrl: urlField.input.value.trim() || null,
      artistName: artistField.input.value.trim() || null,
      tintable: radioGroup.getValue(),
    };
    if (!meta.name) return;
    userIconStore.add({
      name: meta.name,
      tintable: meta.tintable,
      fillSvg: pendingIngest.sanitizedSvg,
      attribution:
        meta.sourceUrl || meta.artistName
          ? { sourceUrl: meta.sourceUrl, artistName: meta.artistName }
          : null,
    });
    pendingIngest = null;
    showGridView(modal, pin.id);
  });
  actions.appendChild(addBtn);

  sub.appendChild(actions);

  // Wire ingestion. Both sources (file + textarea) feed runIngest with
  // the raw text. The latest run wins.
  const runIngest = (rawText) => {
    if (!rawText) {
      tintedCol.preview.replaceChildren();
      asIsCol.preview.replaceChildren();
      errorEl.textContent = "";
      addBtn.disabled = true;
      pendingIngest = null;
      return;
    }
    const result = ingestSvg(rawText);
    if (!result.ok) {
      errorEl.textContent = result.error;
      tintedCol.preview.replaceChildren();
      asIsCol.preview.replaceChildren();
      addBtn.disabled = true;
      pendingIngest = null;
      return;
    }
    errorEl.textContent = "";
    pendingIngest = result;
    radioGroup.setRecommendation(result.suggestedTintable);
    radioGroup.selectInitial(result.suggestedTintable);
    const dataUrl =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(result.sanitizedSvg);
    tintedCol.preview.replaceChildren(makePreviewImg(dataUrl));
    asIsCol.preview.replaceChildren(makePreviewImg(dataUrl));
    addBtn.disabled = nameField.input.value.trim().length === 0;
  };

  textarea.addEventListener("input", () => runIngest(textarea.value));

  nameField.input.addEventListener("input", () => {
    addBtn.disabled =
      !pendingIngest || nameField.input.value.trim().length === 0;
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("icon-picker-modal__drop-zone--active");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("icon-picker-modal__drop-zone--active");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("icon-picker-modal__drop-zone--active");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/svg/.test(file.type) && !file.name.toLowerCase().endsWith(".svg")) {
      errorEl.textContent = "Drop an .svg file.";
      return;
    }
    file.text().then((text) => {
      textarea.value = text;
      runIngest(text);
    });
  });

  modal.replaceChildren(sub);
}

function makeField(labelText, inputType, hint) {
  const wrap = document.createElement("div");
  wrap.className = "icon-picker-modal__field";

  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);

  const input = document.createElement("input");
  input.type = inputType;
  wrap.appendChild(input);

  if (hint) {
    const hintEl = document.createElement("span");
    hintEl.className = "icon-picker-modal__hint";
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }
  return { wrap, input };
}

function makePreviewColumn(labelText, color) {
  const wrap = document.createElement("div");
  wrap.className = "icon-picker-modal__preview-col";

  const label = document.createElement("span");
  label.className = "icon-picker-modal__preview-label";
  label.textContent = labelText;
  wrap.appendChild(label);

  const preview = document.createElement("div");
  preview.className = "icon-picker-modal__preview";
  if (color) preview.style.color = color;
  wrap.appendChild(preview);

  return { wrap, preview };
}

function makePreviewImg(dataUrl) {
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "Preview";
  return img;
}

function makeTintableRadioGroup() {
  const wrap = document.createElement("div");
  wrap.className = "icon-picker-modal__field icon-picker-modal__radio-group";

  const titleSpan = document.createElement("label");
  titleSpan.textContent = "Tinting";
  wrap.appendChild(titleSpan);

  // Tint option.
  const tintLabel = document.createElement("label");
  const tintInput = document.createElement("input");
  tintInput.type = "radio";
  tintInput.name = "tintable";
  tintInput.value = "true";
  tintLabel.appendChild(tintInput);
  tintLabel.appendChild(document.createTextNode(" Tint with pin color"));
  const tintRecommend = document.createElement("span");
  tintRecommend.className =
    "icon-picker-modal__recommend icon-picker-modal__recommend--hidden";
  tintRecommend.textContent = " (recommended)";
  tintLabel.appendChild(tintRecommend);
  wrap.appendChild(tintLabel);

  // As-is option.
  const asisLabel = document.createElement("label");
  const asisInput = document.createElement("input");
  asisInput.type = "radio";
  asisInput.name = "tintable";
  asisInput.value = "false";
  asisInput.checked = true;
  asisLabel.appendChild(asisInput);
  asisLabel.appendChild(document.createTextNode(" Use as-is"));
  const asisRecommend = document.createElement("span");
  asisRecommend.className = "icon-picker-modal__recommend";
  asisRecommend.textContent = " (recommended)";
  asisLabel.appendChild(asisRecommend);
  wrap.appendChild(asisLabel);

  return {
    wrap,
    setRecommendation(suggestTintable) {
      tintRecommend.classList.toggle(
        "icon-picker-modal__recommend--hidden",
        !suggestTintable
      );
      asisRecommend.classList.toggle(
        "icon-picker-modal__recommend--hidden",
        suggestTintable
      );
    },
    selectInitial(suggestTintable) {
      if (suggestTintable) {
        tintInput.checked = true;
      } else {
        asisInput.checked = true;
      }
    },
    getValue() {
      return tintInput.checked;
    },
  };
}
```

- [ ] **Step 3: Verify in browser**
  1. Reload.
  2. Open the icon picker on any pin.
  3. Click "+ Add" in the My icons category. Sub-view appears.
  4. Type "Test" in Name.
  5. Paste a single-color SVG into the textarea, e.g. `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="24" fill="black"/></svg>`. Expected: previews render; "(recommended)" appears next to "Tint with pin color"; "Tinting: Tint with pin color" radio becomes selected.
  6. Replace with a multi-color SVG: `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="24" fill="red"/><circle cx="32" cy="32" r="12" fill="blue"/></svg>`. Expected: "(recommended)" moves to "Use as-is"; that radio becomes selected.
  7. Replace with a malicious SVG: `<svg><script>alert(1)</script></svg>`. Expected: error message "SVG contains content that can't be safely imported: <script>." Add button stays disabled.
  8. Restore a clean SVG. Click Add. Sub-view returns to grid view; new icon appears in My icons.
  9. Click the new icon for the pin. Marker on the map updates to the custom icon.
  10. Reload the page. Custom icon persists in the registry; marker still renders.
  11. Drop a non-SVG file (e.g. a JPG). Expected: "Drop an .svg file." error.

- [ ] **Step 4: Commit**

```bash
git add js/icon-picker.js
git commit -m "feat(icon-picker): add-icon sub-view with three input paths

File drop, textarea paste, and URL field all converge on
ingestSvg() for sanitization. Live tinted + as-is previews render
from the sanitized markup. The 'recommended' radio-label tracks
the heuristic. Source URL is attribution-only; never fetched.
All DOM construction via createElement (no innerHTML)."
```

---

## Task 14: User-icon delete cascade verification

**Files:**
- (no code changes — verification only)

The trash button added in Task 11 already cascades. Now that user icons can actually be created (Task 13), verify the full delete flow end-to-end.

- [ ] **Step 1: Verify in browser**
  1. Add a custom icon via the sub-view (Task 13 flow).
  2. Open the picker on any pin, pick the custom icon.
  3. Confirm the marker renders.
  4. Reopen the picker; hover the custom icon tile in My icons. Trash icon appears.
  5. Click the trash. Confirm dialog: "Delete \"…\"? Pins using it will reset to the default icon."
  6. Confirm. Modal re-renders without the custom icon. The previously-using pin's marker reverts to the default drop-pin (`map-pin`).
  7. Verify in the pin's storage entry: `pin.icon` is now `null`.
  8. DevTools console: `getMap().hasImage("city-pin-map.icon." + /* deleted-icon-id */)` — may still return `true` until the next `setStyle` call (the registry doesn't proactively `removeImage`); that's fine because no feature references the id anymore.

If anything misbehaves (e.g. cascade doesn't fire, modal doesn't refresh), trace through `tile`'s click handler in `buildTile` (Task 11's code) — it should call `updatePin(p.id, { icon: null })` for each affected pin AND `userIconStore.remove(icon.id)`.

- [ ] **Step 2: Commit (verification-only)**

```bash
git commit --allow-empty -m "verify: user-icon delete cascade-clears pin.icon to null"
```

---

## Task 15: Backup v1 ↔ v2 migration

**Files:**
- Modify: `js/backup.js`

- [ ] **Step 1: Replace the entire body of `js/backup.js` with:**

```js
// JSON-file backup and restore for pins, groups, and user-uploaded icons.
// The download path mirrors the trigger-download anchor pattern from
// js/export.js. UI preferences (map style, route toggle, export text,
// export format, hide-labels) are intentionally excluded — see
// HARDEN-001 task file's "Out of scope" section. API keys are also
// excluded (CLAUDE.md hard rule #3).
//
// PIL-001 bumps the format from v1 to v2. v2 includes userIcons. v1
// backups are still importable; their userIcons array is implicitly
// empty and the importing device's existing user-icon library is left
// untouched (same treatment as API keys: backups touch only the keys
// they include).

import * as pinStore from "./pins.js";
import * as groupStore from "./groups.js";
import * as userIconStore from "./user-icons.js";
import { showError } from "./storage.js";

const BACKUP_VERSION = 2;
const SUPPORTED_IMPORT_VERSIONS = new Set([1, 2]);

const CONFIRM_MESSAGE_V2 =
  "Replace your current pins, groups, and custom icons with the contents of this file? Existing data will be lost.";

const CONFIRM_MESSAGE_V1 =
  "Replace your current pins and groups with the contents of this file? Existing data will be lost.\n\n(This is a v1 backup — your custom icon library will be left untouched.)";

export function exportToJson() {
  try {
    const payload = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      pins: pinStore.listPins(),
      groups: groupStore.listGroups(),
      userIcons: userIconStore.list(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    try {
      triggerDownload(url, `city-pin-map-${todayStamp()}.json`);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error("JSON export failed:", err);
    showError("Could not export JSON. Try again.");
  }
}

export async function importFromJson(file) {
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (err) {
    console.error("could not read backup file:", err);
    showError("Could not read that file. Try again.");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("backup file is not valid JSON:", err);
    showError("That file is not valid JSON.");
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    showError("That file is not a City Pin Map backup.");
    return;
  }

  if (!SUPPORTED_IMPORT_VERSIONS.has(parsed.version)) {
    showError(
      typeof parsed.version === "number" && parsed.version > BACKUP_VERSION
        ? "This backup was made with a newer version of the app."
        : "This backup file uses an unsupported format version."
    );
    return;
  }

  if (!Array.isArray(parsed.pins) || !Array.isArray(parsed.groups)) {
    showError("Backup file is missing pins or groups.");
    return;
  }

  const isV2 = parsed.version === 2;
  if (isV2 && !Array.isArray(parsed.userIcons)) {
    showError("Backup file is missing the userIcons field.");
    return;
  }

  const message = isV2 ? CONFIRM_MESSAGE_V2 : CONFIRM_MESSAGE_V1;
  if (!confirm(message)) return;

  // Replace order: groups before pins (NICE-005's stale-ref handling
  // tolerates the transient mismatch either way; loading dependencies
  // first reads naturally). Then user-icons last for v2.
  groupStore.replaceAll(parsed.groups);
  pinStore.replaceAll(parsed.pins);
  if (isV2) {
    userIconStore.replaceAll(parsed.userIcons);
  }
  // v1: userIconStore is intentionally untouched.
}

function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function todayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
```

- [ ] **Step 2: Verify in browser**
  1. Add some pins, groups, and custom icons.
  2. Click Export JSON. Open the downloaded file in a text editor. Verify it has `"version": 2` and a `userIcons` array.
  3. Modify the file: change `"version": 2` to `"version": 1` and remove the `userIcons` field entirely.
  4. Click Import JSON; pick the modified file. Confirm dialog should mention "v1 backup — your custom icon library will be left untouched."
  5. After import, verify: pins/groups replaced from file; existing user icons in localStorage remain.
  6. Repeat with the original v2 file. Confirm dialog uses the standard message; user icons replaced.
  7. Try importing a `"version": 99` file. Expect the "newer version" error.

- [ ] **Step 3: Commit**

```bash
git add js/backup.js
git commit -m "feat(backup): v2 format with userIcons; v1 still importable

Bumps BACKUP_VERSION to 2. v2 export includes userIcons. v1 imports
leave the importing device's user-icon library untouched (same
treatment as API keys). v2 imports replace user icons in full
(replace-by-id last-writer-wins semantics)."
```

---

## Task 16: CLAUDE.md "What's shipped" + final acceptance verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: In `CLAUDE.md`, find the "What's shipped" section. Add a bullet after the last existing entry (the expanded basemap styles bullet):**

```markdown
- **Pin icon library (PIL-001):** expanded the per-pin icon picker from PI-001's 6 starter icons to a categorized library of ~26 (Default + Pins + Travel + Places + Transport + Markers, all MIT-licensed silhouettes). Replaced the popover with a modal hosted in `js/icon-picker.js`. New module `js/icons.js` is the registry — merging built-in icons (`BUILTIN_ICONS` array) with user-uploaded custom icons (`js/user-icons.js`, `localStorage` key `city-pin-map.user-icons.v1`). Users add custom icons via a sub-view in the modal: file drop, textarea paste, or URL field (URL is attribution-only — never fetched, since browser CORS + Flaticon login wall make download impossible from a no-backend page). New module `js/svg-ingest.js` sanitizes incoming SVG via an allowlist (rejects `<script>`, `<foreignObject>`, `on*` handlers, `javascript:` hrefs) and returns a tintable heuristic. Hybrid color: tintable icons (the entire starter set, monochrome user uploads) keep the SDF + halo treatment from PI-001; non-tintable icons render in original colors with a circle layer underneath (`pins-color-ring`) showing group/pin color. Backup format bumped v1 → v2 with `userIcons` included; v1 backups still import (user-icon library left untouched on v1 import, same as API keys). Sprite-id namespacing under `city-pin-map.icon.<id>` (carried forward from PI-001) keeps the registry collision-free against basemap atlases.
```

- [ ] **Step 2: Update the file layout block in `CLAUDE.md`. Find the `js/` listing and update the count + relevant entries:**

```markdown
├── js/                 # 18 ES modules
│   ├── app.js          # Bootstrap + glue
│   ├── map.js          # MapLibre init, basemap registry, marker fill layer with halo paint, color-ring layer for non-tintable icons, drag, route layer, effectiveColor()
│   ├── icons.js        # Icon registry: BUILTIN_ICONS + user-icon merge + effectiveIcon()
│   ├── icon-picker.js  # Modal grid view + add-icon sub-view + per-icon delete
│   ├── user-icons.js   # User-icon store: pub/sub + localStorage CRUD
│   ├── svg-ingest.js   # Pure: sanitize + normalize + tintable heuristic
│   ├── geocode.js      # Nominatim wrapper
│   ├── search.js       # Search input → debounced geocode → addPin
│   ├── pins.js         # Pin store
│   ├── pin-list.js     # Side-panel pin list
│   ├── groups.js       # Group store
│   ├── group-panel.js  # Side-panel group list
│   ├── settings.js     # Per-provider API key store
│   ├── settings-panel.js # Settings modal renderer
│   ├── style-picker.js # Searchable popover picker for basemaps
│   ├── storage.js      # localStorage keys + showError() banner
│   ├── backup.js       # JSON v1↔v2 export/import (incl. userIcons in v2)
│   └── export.js       # PNG export pipeline
└── assets/
    └── icons/          # 26 SVG files: 6 from PI-001 + 20 from PIL-001 starter set
```

- [ ] **Step 3: Final end-to-end acceptance sweep (maps to spec § Acceptance criteria)**

  1. **Default rendering unchanged**: open the app, pin a city via search. New pin renders as the default drop-pin (`map-pin`), tinted with its color.
  2. **Per-pin icon thumbnail**: each pin row shows the appearance tile + color swatch. The tile reflects the chosen icon at the chosen color.
  3. **Modal opens**: click the appearance tile. Modal appears with categorized grid (Default, Pins, Travel, Places, Transport, Markers, My icons). Search filters by name.
  4. **Tintable pick**: select e.g. `star`. Marker tints with pin color; halo (white inner contour) visible on every basemap. Verify by cycling through 5 basemaps.
  5. **Group color override**: assign the pin to a group with a vivid color. Marker recolors to group color. Unassign group, marker reverts to pin color.
  6. **Add custom icon (tintable)**: open picker → + Add → name "MyHeart" → paste `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><path d="M32 16 C32 16, 16 16, 16 32 C 16 48, 32 56, 32 56 C 32 56, 48 48, 48 32 C 48 16, 32 16, 32 16 Z" fill="black"/></svg>` → "Tint with pin color (recommended)" pre-selected → Add. Pick MyHeart for the pin. Marker tints with pin color, halo appears.
  7. **Add custom icon (non-tintable)**: paste a multi-color SVG. "(recommended)" sits next to Use as-is. Add. Pick. Marker renders in original colors WITH a colored ring underneath showing group/pin color.
  8. **Sanitization rejects**: paste `<svg><script>alert(1)</script></svg>`. Error message appears. Add disabled.
  9. **URL field is attribution-only**: paste a Flaticon URL into the Source URL field. Hint text says "not downloaded". After Add, hover the icon tile — tooltip shows the URL.
  10. **Cascade-clear on delete**: delete the custom icon. Confirm. The pin using it reverts to default drop-pin. `pin.icon` in localStorage is `null`.
  11. **Sprite-id namespacing**: in DevTools console, `getMap().listImages().filter(id => id.startsWith("city-pin-map.icon."))` — all custom icon ids appear with the prefix; no collision with basemap sprites.
  12. **Backup v2**: Export JSON. File contains `"version": 2` and `userIcons: [...]`. Import the same file: confirm message lists "pins, groups, and custom icons". Imports cleanly.
  13. **Backup v1 compat**: hand-edit a backup to `"version": 1` and remove `userIcons`. Import: confirm message says "v1 backup — your custom icon library will be left untouched". Pins/groups replaced; user icons preserved.
  14. **Style swap preserves all icons**: with custom icons in the registry, cycle through every available basemap (vector + raster). Markers persist on every style; no console errors; no missing icons.
  15. **Drag works on all icons**: pick a non-tintable custom icon, drag the pin. Pin tip stays glued to the cursor; commit on mouseup updates `lat/lon`.
  16. **PNG export captures the new shapes**: export as PNG with a custom-icon pin visible. Open the downloaded PNG. Custom icon renders correctly (full-color for non-tintable; tinted for tintable).
  17. **No console errors anywhere in the above**.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for PIL-001

Adds 'What's shipped' bullet for the pin icon library milestone.
Updates the file layout block to list the 4 new modules and the
18-module total."
```

---

## Self-review notes

This plan was self-reviewed against the spec at the time of writing. Coverage check:

- ✅ Spec § Pin schema (additive `icon` field) → Task 1
- ✅ Spec § User-icon entity → Task 2
- ✅ Spec § Architecture / new modules → Tasks 2, 4, 9, 11
- ✅ Spec § Render pipeline (sprite prefix, halo, two layers) → Tasks 5, 6, 7 (sprite prefix and halo were already shipped from PI-001 — confirmed in plan's "Current state" table)
- ✅ Spec § Layer ordering with PO-002 labels → Task 7's verification step 3
- ✅ Spec § Picker modal grid view → Tasks 10, 11, 12
- ✅ Spec § Add-icon sub-view → Task 13
- ✅ Spec § Edge cases (cascade-clear) → Task 14
- ✅ Spec § Backup v1 ↔ v2 → Task 15
- ✅ Spec § Acceptance criteria → Task 16's final verification sweep maps each criterion

No placeholders, all task code blocks contain actual code. Tasks reference each other by number where prerequisites apply.

Pragmatic deviations from the spec (worth flagging during execution):

1. The spec said "user-icon tiles render in the pin's currently-active color so the user previews the result before clicking" but the picker tile's `<img>` rendering doesn't pick up CSS `color` for built-in `src`-based icons (browsers don't apply `color` to `<img>` content). Tasks 11 and 12 both use `<img>` for simplicity. If tinted previews matter more than simplicity, a follow-up can swap to inline-SVG insertion (parse each registry entry once and append the parsed root). Tracked here so it's visible at execution time.
2. The spec referenced `pixelRatio: 2` in passing; the shipped PI-001 code uses `pixelRatio: 4` with 128×128 source SVGs (better SDF rasterization). The plan keeps `pixelRatio: 4`. The spec's note will be aligned during the next pass.

All DOM construction in Tasks 11 and 13 uses `createElement` + property assignment — no `innerHTML`, no template strings written to the DOM. This is a deliberate XSS-defense default given the module also handles untrusted SVG markup (the sanitization layer in Task 9 protects the SVG payload itself, but the picker's chrome rendering is independently safe).
