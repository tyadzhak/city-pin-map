# Expanded Basemap Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~22 free-tier basemap styles (Stadia, MapTiler, Thunderforest) on top of the existing 7, with a searchable picker popover replacing the current `<select>` and a settings modal for per-provider API keys.

**Architecture:** Two new conceptual layers — (a) a settings store (`js/settings.js`) mirroring the pub/sub shape of `pins.js`/`groups.js`, persisting three API keys to `localStorage`; (b) a `setStyleSafely()` wrapper in `js/map.js` that resolves `{api_key}` placeholders at swap time and races `styledata` (success) vs `error` (failure) events with a 5s timeout, reverting on failure. Two new UI surfaces — a popover picker (`js/style-picker.js`) replacing the header `<select>`, and a settings modal (`js/settings-panel.js`) for key entry. Registry shape grows by two optional fields (`provider`, `requiresToken`); existing entries are backfilled with `provider`.

**Tech Stack:** Vanilla ES modules, MapLibre GL JS 4.7.1 (CDN), HTML/CSS, `localStorage`. **No build step**, **no test runner** — verification is manual browser interaction (project hard rule per CLAUDE.md).

**Spec:** `docs/superpowers/specs/2026-05-08-more-basemap-styles-design.md`

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `js/storage.js` | Modify | Add 3 module-private localStorage key constants + `loadApiKey(provider)` / `saveApiKey(provider, value)` / `loadAllApiKeys()` helpers. Mirror of existing `loadMapStyle` / `saveMapStyle` shape. |
| `js/settings.js` | **Create** | Settings store. Pub/sub mirroring `pins.js`/`groups.js`. `hydrate()`, `getKey(provider)`, `setKey(provider, value)`, `getAllKeys()`, `subscribe(fn)`, `isProviderUnlocked(provider)`. |
| `js/map.js` | Modify | (a) Backfill `provider` on existing 7 `MAP_STYLES` entries. (b) Add ~22 new entries with `requiresToken` + `{api_key}`-templated URLs. (c) Add `resolveStyleUrl(entry)` helper. (d) Replace `setMapStyle` body with `setStyleSafely` semantics (records `previousStyleId`, races `styledata`/`error`/timeout, reverts on failure). Keep the export name `setMapStyle` so the existing `app.js` import keeps working. |
| `index.html` | Modify | Replace `<select id="map-style-select">` with `<button id="map-style-trigger">` + popover root. Add settings modal root. Add `⚙` button in side-panel pin-list header next to Export/Import JSON. |
| `css/styles.css` | Modify | Add styles for the picker popover (search input, grouped list, locked rows, footer), the settings modal (overlay, panel, sections, password input + show/hide toggle), and status pills. |
| `js/style-picker.js` | **Create** | Popover renderer. Click trigger → open. Search filter (debounced 100ms) → grouped list → keyboard nav → row click selects style → locked-row click opens settings modal scrolled to that provider. |
| `js/settings-panel.js` | **Create** | Modal renderer. Click ⚙ → open. Input blur → save key → status pill flip. Locked-row deep-link from picker. |
| `js/app.js` | Modify | Re-order hydration: settings → pins → groups. Wire new picker + settings panel. Boot-time guard: persisted style requires missing key → showError + fall back to `DEFAULT_MAP_STYLE_ID`. Remove `initMapStyleSelector`. |
| `CLAUDE.md` | Modify | Hard rule #3 replacement (free-tier API keys allowed; corrects stale "Leaflet" reference). Add the new feature to "What's shipped". |

**Files NOT touched (scope guard — implementer should resist incidental refactoring):**
`js/pins.js`, `js/pin-list.js`, `js/groups.js`, `js/group-panel.js`, `js/geocode.js`, `js/search.js`, `js/export.js`, `js/backup.js`.

---

## A note on testing in this codebase

This project has **no test runner, no build step**. Verification is manual browser interaction per CLAUDE.md → "Hard rules" #1 and #5. Each task below ends with a concrete verification step:

> **Verify**: open `http://localhost:8000/` (or via `start.command`), perform action X, observe outcome Y in the browser/devtools.

This adaptation replaces the standard TDD red/green/refactor loop. The acceptance criteria in the spec (§ "Acceptance test plan") are the source of truth for "done".

---

## Task 1: API key storage primitives in `js/storage.js`

**Files:**
- Modify: `js/storage.js` (additions only — no existing function changes)

- [ ] **Step 1: Add 3 module-private localStorage key constants near the top of `js/storage.js`**

Add these constants immediately after the existing `EXPORT_FORMAT_KEY` line (line 6 of the current file):

```js
// API keys for free-tier basemap providers (Stadia / MapTiler / Thunderforest).
// Stored as bare strings — same convention as MAP_STYLE_KEY. Never inlined in
// source; never included in JSON backup exports (see backup.js scope).
const STADIA_API_KEY = "city-pin-map.stadia-key.v1";
const MAPTILER_API_KEY = "city-pin-map.maptiler-key.v1";
const THUNDERFOREST_API_KEY = "city-pin-map.thunderforest-key.v1";

const API_KEY_STORAGE_BY_PROVIDER = {
  stadia: STADIA_API_KEY,
  maptiler: MAPTILER_API_KEY,
  thunderforest: THUNDERFOREST_API_KEY,
};
```

- [ ] **Step 2: Append the three exported helpers at the end of the file (after the existing `showError` function is fine — exact placement doesn't matter as long as they're at module scope)**

```js
// Per-provider API key load/save. Mirrors the bare-string convention of
// loadMapStyle/saveMapStyle — values are short opaque strings, JSON wrapping
// would only add quote noise. Empty string and missing-key are equivalent
// ("not set"). Unknown providers are no-ops, not throws, so a stale provider
// id from older app state can never crash the boot path.
export function loadApiKey(provider) {
  const storageKey = API_KEY_STORAGE_BY_PROVIDER[provider];
  if (!storageKey) return "";
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch (err) {
    console.error("localStorage unavailable on api key read:", err);
    return "";
  }
}

export function saveApiKey(provider, value) {
  const storageKey = API_KEY_STORAGE_BY_PROVIDER[provider];
  if (!storageKey) return;
  try {
    if (value) {
      localStorage.setItem(storageKey, value);
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch (err) {
    console.error("failed to save api key:", err);
    showError(
      "Could not save API key (storage may be full). It will reset on refresh."
    );
  }
}

export function loadAllApiKeys() {
  return {
    stadia: loadApiKey("stadia"),
    maptiler: loadApiKey("maptiler"),
    thunderforest: loadApiKey("thunderforest"),
  };
}
```

- [ ] **Step 3: Verify in browser**

Run `python3 -m http.server 8000` (or double-click `start.command`). Open `http://localhost:8000/`. Open DevTools console. Run:

```js
const m = await import('./js/storage.js');
m.saveApiKey('stadia', 'TEST_KEY_123');
console.log(m.loadApiKey('stadia'));     // expect: "TEST_KEY_123"
console.log(m.loadAllApiKeys());          // expect: { stadia: "TEST_KEY_123", maptiler: "", thunderforest: "" }
m.saveApiKey('stadia', '');
console.log(m.loadApiKey('stadia'));     // expect: ""
console.log(localStorage.getItem('city-pin-map.stadia-key.v1')); // expect: null
```

Expected: all four `console.log` outputs match the comments above. The localStorage round-trip is intact and clearing the key removes the localStorage entry.

- [ ] **Step 4: Commit**

```bash
git add js/storage.js
git commit -m "more-styles: add api-key storage primitives"
```

---

## Task 2: Create `js/settings.js` store

**Files:**
- Create: `js/settings.js`

- [ ] **Step 1: Create the file with the full contents below**

```js
// js/settings.js — In-memory store for per-provider API keys.
//
// Mirrors the pub/sub shape of pins.js and groups.js. Three providers
// (stadia, maptiler, thunderforest); each key is a string. Empty string
// = "not set". The store does NOT validate keys — invalid keys surface
// when the user picks a token-required style and the style JSON fetch
// fails, routed through map.js setStyleSafely → storage.js showError.
//
// Single source of truth during a session is the in-memory `state`
// object. localStorage round-trips happen at hydrate() and on every
// setKey() call, via the storage.js loadApiKey/saveApiKey wrappers.

import { loadAllApiKeys, saveApiKey } from "./storage.js";

const VALID_PROVIDERS = ["stadia", "maptiler", "thunderforest"];

const state = {
  stadia: "",
  maptiler: "",
  thunderforest: "",
};

const subscribers = new Set();

function notify() {
  // Snapshot copy so subscribers can't mutate the live state.
  const snapshot = { ...state };
  for (const fn of subscribers) {
    fn(snapshot);
  }
}

// Load all three keys from localStorage into the in-memory state. Call
// once at boot, before any consumer (style picker, settings panel, map
// resolver) reads the store. Idempotent — safe to call again, but the
// usual call site is app.js init().
export function hydrate() {
  const loaded = loadAllApiKeys();
  for (const provider of VALID_PROVIDERS) {
    state[provider] = loaded[provider] ?? "";
  }
  notify();
}

export function getKey(provider) {
  if (!VALID_PROVIDERS.includes(provider)) return "";
  return state[provider];
}

export function setKey(provider, value) {
  if (!VALID_PROVIDERS.includes(provider)) return;
  const next = value ?? "";
  if (state[provider] === next) return; // no-op on identical value
  state[provider] = next;
  saveApiKey(provider, next);
  notify();
}

export function getAllKeys() {
  return { ...state };
}

// True when either (a) the provider is keyless (not in VALID_PROVIDERS —
// e.g. openfreemap, wikimedia) or (b) a non-empty key is set. The picker
// uses this to decide whether to show a row as locked.
export function isProviderUnlocked(provider) {
  if (!VALID_PROVIDERS.includes(provider)) return true;
  return Boolean(state[provider]);
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
```

- [ ] **Step 2: Verify in browser**

Reload `http://localhost:8000/`. In DevTools console:

```js
const s = await import('./js/settings.js');
s.hydrate();
console.log(s.getAllKeys());             // expect: { stadia: "", maptiler: "", thunderforest: "" }
console.log(s.isProviderUnlocked('stadia'));      // expect: false
console.log(s.isProviderUnlocked('openfreemap')); // expect: true (keyless = always unlocked)

let snap;
const unsub = s.subscribe((next) => { snap = next; });
s.setKey('stadia', 'ABC');
console.log(snap);                        // expect: { stadia: "ABC", maptiler: "", thunderforest: "" }
console.log(s.isProviderUnlocked('stadia'));      // expect: true

s.setKey('stadia', '');                   // clear
console.log(localStorage.getItem('city-pin-map.stadia-key.v1')); // expect: null
unsub();
```

Expected: all `console.log` lines match. The subscribe callback fires on setKey and the snapshot reflects the latest state.

- [ ] **Step 3: Commit**

```bash
git add js/settings.js
git commit -m "more-styles: settings store for per-provider api keys"
```

---

## Task 3: Add `resolveStyleUrl()` and replace `setMapStyle` body in `js/map.js`

**Files:**
- Modify: `js/map.js` (replace `setMapStyle` body with the safe-swap semantics; add `resolveStyleUrl` helper; update import list)

This task only changes the wrapper around `setStyle()`. No new MAP_STYLES entries yet — the existing 7 styles continue to work unchanged. New entries land in Task 8.

The export name stays `setMapStyle` so `app.js`'s existing import keeps working — only the function body changes.

- [ ] **Step 1: Update the import block at the top of `js/map.js`**

The current top reads:

```js
import { updatePin } from "./pins.js";
import { listGroups } from "./groups.js";
import { saveMapStyle } from "./storage.js";
```

Replace with:

```js
import { updatePin } from "./pins.js";
import { listGroups } from "./groups.js";
import { saveMapStyle, showError } from "./storage.js";
import * as settings from "./settings.js";
```

- [ ] **Step 2: Add `resolveStyleUrl()` immediately above the existing `setMapStyle()` (around line 150, before its JSDoc)**

```js
/**
 * Resolve a MAP_STYLES entry's `style` value with any `{api_key}`
 * placeholder substituted from the settings store. Returns the value
 * MapLibre's `setStyle()` accepts directly — either a URL string or an
 * inline raster style object.
 *
 * Three input shapes:
 *   - String URL with no placeholder (existing keyless vector entries)
 *   - String URL with `{api_key}` (Stadia, MapTiler vector entries)
 *   - Inline raster object whose `sources.<id>.tiles[]` may contain
 *     `{api_key}` (Thunderforest raster entries)
 *
 * Throws if `requiresToken` is set on the entry but the key is empty —
 * caller (setMapStyle) translates the throw into a user-visible banner
 * via showError() and aborts the swap.
 */
function resolveStyleUrl(entry) {
  const apiKey = entry.requiresToken
    ? settings.getKey(entry.requiresToken)
    : "";
  if (entry.requiresToken && !apiKey) {
    const provider =
      entry.requiresToken.charAt(0).toUpperCase() + entry.requiresToken.slice(1);
    throw new Error(`${provider} API key not set`);
  }

  if (typeof entry.style === "string") {
    return apiKey ? entry.style.replaceAll("{api_key}", apiKey) : entry.style;
  }

  // Inline style object — deep clone before substitution so MAP_STYLES
  // entries stay immutable across swaps.
  const resolved = JSON.parse(JSON.stringify(entry.style));
  if (apiKey) {
    for (const source of Object.values(resolved.sources || {})) {
      if (Array.isArray(source.tiles)) {
        source.tiles = source.tiles.map((url) =>
          url.replaceAll("{api_key}", apiKey)
        );
      }
    }
  }
  return resolved;
}

function buildStyleErrorMessage(entry, status) {
  const provider = entry.provider
    ? entry.provider.charAt(0).toUpperCase() + entry.provider.slice(1)
    : "Map style";
  if (status === 401 || status === 403) {
    return `${provider} rejected the API key. Verify it in Settings.`;
  }
  if (status === 429) {
    return `${provider} free-tier quota exceeded. Try again later.`;
  }
  // status === 0 means our timeout fired or a generic network error.
  return `Failed to load style. Check your connection.`;
}
```

- [ ] **Step 3: Replace the existing `setMapStyle()` function body**

Find the current `setMapStyle` (currently around lines 150-181). Delete the entire JSDoc + function. In its place, paste:

```js
// Track the currently-rendered style id so a failed swap can revert.
// Different from the user's last *click*: this updates only on the
// `styledata` success path. Initialized lazily on the first successful
// swap; null until then means "whatever initMap painted".
let currentRenderedStyleId = null;

const STYLE_LOAD_TIMEOUT_MS = 5000;

/**
 * Swap the active basemap to the style identified by `styleId`, with
 * resilience: races styledata (success) against error (failure) and a
 * 5s timeout. On failure, reverts to the previously-rendered style and
 * surfaces a banner via showError(). The persisted style id (saveMapStyle)
 * only updates on success — reload is guaranteed to boot into a known-
 * working style.
 *
 * Falls back to the default with a console.warn if the id isn't known.
 */
export function setMapStyle(styleId, { persist = true } = {}) {
  if (!mapInstance) return;

  let entry = MAP_STYLES.find((s) => s.id === styleId);
  if (!entry) {
    console.warn(
      `Unknown map style "${styleId}"; falling back to "${DEFAULT_MAP_STYLE_ID}".`
    );
    entry = MAP_STYLES.find((s) => s.id === DEFAULT_MAP_STYLE_ID);
  }

  // Snapshot of the style we'll revert to if the swap fails.
  const previousId = currentRenderedStyleId ?? DEFAULT_MAP_STYLE_ID;

  let resolved;
  try {
    resolved = resolveStyleUrl(entry);
  } catch (err) {
    // Pre-flight error (missing token). Don't touch the map — leave the
    // current style in place. The picker should already reflect this
    // since locked rows route to settings, but defensive belt+braces.
    showError(`${err.message}. Open Settings (⚙ in side panel) to add one.`);
    return;
  }

  // First-event-wins race: styledata = success, error = failure, timeout
  // = treat as failure. Detach all listeners + clear timer when one fires.
  let settled = false;
  const onSuccess = () => {
    if (settled) return;
    settled = true;
    cleanup();
    currentRenderedStyleId = entry.id;
    addPinAndRouteLayers();
    renderPins(lastPinsSnapshot);
    renderRoute(lastPinsSnapshot, { visible: lastRouteVisible });
    if (persist) saveMapStyle(entry.id);
  };
  const onError = (err) => {
    if (settled) return;
    settled = true;
    cleanup();
    const status = err && err.error && err.error.status;
    showError(buildStyleErrorMessage(entry, status));
    // Revert to the previously-rendered style. Pass persist:false so a
    // failed swap can never overwrite the persisted preference.
    if (previousId && previousId !== entry.id) {
      setMapStyle(previousId, { persist: false });
    }
  };
  const cleanup = () => {
    mapInstance.off("styledata", onSuccess);
    mapInstance.off("error", onError);
    if (timer) clearTimeout(timer);
  };
  const timer = setTimeout(
    () => onError({ error: { status: 0 } }),
    STYLE_LOAD_TIMEOUT_MS
  );

  mapInstance.once("styledata", onSuccess);
  // `once` is wrong for error — many errors can fire during a single
  // failing load; we want the FIRST one. Use on() and rely on `settled`.
  mapInstance.on("error", onError);

  mapInstance.setStyle(resolved, { diff: false });
}
```

- [ ] **Step 4: Verify in browser**

Reload the page. The current 7 styles must still work end-to-end. In DevTools console:

```js
const m = await import('./js/map.js');
// Switch styles a couple of times — should be visually identical to before.
m.setMapStyle('carto-dark');
// Wait ~1 second
m.setMapStyle('osm');
m.setMapStyle('topo');
```

Verify: the map paints each style; the persisted preference (`localStorage.getItem('city-pin-map.map-style.v1')`) reflects the last successful swap.

Then test the failure path with a deliberate bogus id:

```js
m.setMapStyle('does-not-exist');
```

Expected: `console.warn` fires; the entry is replaced with the default before swap, so this is a successful swap to OSM, not a failure. No banner.

- [ ] **Step 5: Commit**

```bash
git add js/map.js
git commit -m "more-styles: setStyleSafely semantics with revert-on-failure"
```

---

## Task 4: Settings modal HTML scaffolding + CSS

**Files:**
- Modify: `index.html` (add modal markup + ⚙ button in side-panel pin-list header)
- Modify: `css/styles.css` (add modal + status pill styles)

The modal is hidden by default. Task 5 wires it up.

- [ ] **Step 1: Add the ⚙ button in the side-panel pin-list header in `index.html`**

Find the `<div class="pin-list__header">` block (currently around lines 156-167). Insert a new button at the start of `.backup-controls`, *before* the existing `Export JSON` button:

Current markup:
```html
<div class="pin-list__header">
  <h2 class="pin-list__heading">Pins</h2>
  <div class="backup-controls">
    <button id="export-json" type="button" class="backup-btn">
      Export JSON
    </button>
    <button id="import-json" type="button" class="backup-btn">
      Import JSON
    </button>
  </div>
</div>
```

Replace with:
```html
<div class="pin-list__header">
  <h2 class="pin-list__heading">Pins</h2>
  <div class="backup-controls">
    <button
      id="open-settings"
      type="button"
      class="backup-btn backup-btn--icon"
      aria-label="Open settings"
      title="API keys and preferences"
    >
      ⚙
    </button>
    <button id="export-json" type="button" class="backup-btn">
      Export JSON
    </button>
    <button id="import-json" type="button" class="backup-btn">
      Import JSON
    </button>
  </div>
</div>
```

- [ ] **Step 2: Add the settings modal markup at the end of `<body>` in `index.html`**

Insert immediately before the existing `<script type="module" src="js/app.js"></script>` line:

```html
<!-- Settings modal (closed by default). Wired in js/settings-panel.js.
     Three sections, one per free-tier provider. Inputs persist on blur;
     no explicit Save button. -->
<div
  id="settings-modal"
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="settings-modal-title"
  hidden
>
  <div class="modal__backdrop" data-settings-close></div>
  <div class="modal__panel" role="document">
    <header class="modal__header">
      <h2 id="settings-modal-title" class="modal__title">Settings</h2>
      <button
        type="button"
        class="modal__close"
        aria-label="Close settings"
        data-settings-close
      >
        ×
      </button>
    </header>

    <p class="modal__intro">
      Free-tier API keys for additional basemap styles. Keys are stored only
      in your browser's local storage — never inlined in source, never
      included in JSON backup exports.
    </p>

    <section class="settings-section" data-provider="stadia">
      <header class="settings-section__header">
        <h3 class="settings-section__title">Stadia Maps</h3>
        <span class="status-pill" data-status-for="stadia">Not set</span>
      </header>
      <p class="settings-section__desc">
        Hosts the Stamen artistic styles (Watercolor, Toner) and Alidade
        Smooth.
        <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Get a free key →</a>
      </p>
      <label class="settings-section__field">
        <span class="visually-hidden">Stadia API key</span>
        <input
          type="password"
          class="settings-section__input"
          data-key-input="stadia"
          autocomplete="off"
          spellcheck="false"
          placeholder="Paste your Stadia API key"
        />
        <button
          type="button"
          class="settings-section__reveal"
          data-reveal-for="stadia"
          aria-label="Show or hide key"
          title="Show/hide key"
        >
          👁
        </button>
      </label>
    </section>

    <section class="settings-section" data-provider="maptiler">
      <header class="settings-section__header">
        <h3 class="settings-section__title">MapTiler</h3>
        <span class="status-pill" data-status-for="maptiler">Not set</span>
      </header>
      <p class="settings-section__desc">
        Wide modern catalog — Streets, Outdoor, Winter, Backdrop, Satellite
        Hybrid, and more.
        <a href="https://www.maptiler.com/cloud/" target="_blank" rel="noopener">Get a free key →</a>
      </p>
      <label class="settings-section__field">
        <span class="visually-hidden">MapTiler API key</span>
        <input
          type="password"
          class="settings-section__input"
          data-key-input="maptiler"
          autocomplete="off"
          spellcheck="false"
          placeholder="Paste your MapTiler API key"
        />
        <button
          type="button"
          class="settings-section__reveal"
          data-reveal-for="maptiler"
          aria-label="Show or hide key"
          title="Show/hide key"
        >
          👁
        </button>
      </label>
    </section>

    <section class="settings-section" data-provider="thunderforest">
      <header class="settings-section__header">
        <h3 class="settings-section__title">Thunderforest</h3>
        <span class="status-pill" data-status-for="thunderforest">Not set</span>
      </header>
      <p class="settings-section__desc">
        Specialized themes — OpenCycleMap, Transport, Landscape, Atlas,
        Outdoors, Pioneer.
        <a href="https://www.thunderforest.com/" target="_blank" rel="noopener">Get a free key →</a>
      </p>
      <label class="settings-section__field">
        <span class="visually-hidden">Thunderforest API key</span>
        <input
          type="password"
          class="settings-section__input"
          data-key-input="thunderforest"
          autocomplete="off"
          spellcheck="false"
          placeholder="Paste your Thunderforest API key"
        />
        <button
          type="button"
          class="settings-section__reveal"
          data-reveal-for="thunderforest"
          aria-label="Show or hide key"
          title="Show/hide key"
        >
          👁
        </button>
      </label>
    </section>
  </div>
</div>
```

- [ ] **Step 3: Append the modal + status pill CSS to `css/styles.css`**

Append at the bottom of the file:

```css
/* ===== Settings modal (Task 4 — More basemap styles) ===== */

.modal[hidden] { display: none; }

.modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
}

.modal__panel {
  position: relative;
  width: min(560px, 92vw);
  max-height: 86vh;
  overflow-y: auto;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.35);
  padding: 1.25rem 1.5rem 1.5rem;
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.modal__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.modal__close {
  appearance: none;
  background: transparent;
  border: 0;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  color: #64748b;
  padding: 0.25rem 0.5rem;
}
.modal__close:hover { color: #0f172a; }

.modal__intro {
  margin: 0 0 1rem;
  color: #475569;
  font-size: 0.85rem;
  line-height: 1.45;
}

.settings-section {
  border-top: 1px solid #e2e8f0;
  padding-top: 1rem;
  margin-top: 1rem;
}
.settings-section:first-of-type {
  border-top: 0;
  padding-top: 0;
  margin-top: 0;
}

.settings-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.settings-section__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.settings-section__desc {
  margin: 0 0 0.6rem;
  font-size: 0.85rem;
  color: #475569;
  line-height: 1.4;
}
.settings-section__desc a { color: #2563eb; }

.settings-section__field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0.4rem 0.5rem;
}

.settings-section__input {
  flex: 1;
  border: 0;
  background: transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  outline: none;
}

.settings-section__reveal {
  appearance: none;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.1rem 0.3rem;
  color: #64748b;
}
.settings-section__reveal:hover { color: #0f172a; }

.status-pill {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
}
.status-pill.is-set {
  background: #dcfce7;
  color: #166534;
}

/* Square gear icon button — same height as the existing .backup-btn but
   without the wide horizontal padding. */
.backup-btn--icon {
  padding-left: 0.5rem;
  padding-right: 0.5rem;
  font-size: 1rem;
  line-height: 1;
}
```

- [ ] **Step 4: Verify in browser**

Reload the page. Expected:
- A new `⚙` button appears in the pin-list header, to the left of `Export JSON`.
- Clicking the button does nothing yet (no JS wired). The modal is still hidden.
- In DevTools console:
  ```js
  document.getElementById('settings-modal').hidden = false;
  ```
  → modal appears centered, with three provider sections, password inputs, and "Not set" pills (grey).
  ```js
  document.getElementById('settings-modal').hidden = true;
  ```
  → modal disappears.

- [ ] **Step 5: Commit**

```bash
git add index.html css/styles.css
git commit -m "more-styles: settings modal scaffolding + gear button"
```

---

## Task 5: Create `js/settings-panel.js` and wire from `app.js`

**Files:**
- Create: `js/settings-panel.js`
- Modify: `js/app.js` (import + invoke `initSettingsPanel`; hydrate the settings store)

- [ ] **Step 1: Create `js/settings-panel.js` with the full contents below**

```js
// js/settings-panel.js — Renders the settings modal.
//
// Wires:
//   - #open-settings click → open modal
//   - .modal__close + .modal__backdrop + Escape → close
//   - input blur per [data-key-input] → settings.setKey(...) + status pill flip
//   - .settings-section__reveal click → toggle input type between password/text
//
// The modal stays in the DOM at all times; we toggle the [hidden] attribute.
// Status pills hydrate from settings.getAllKeys() on open and on every store
// notify (via subscribe).

import * as settings from "./settings.js";

const PROVIDERS = ["stadia", "maptiler", "thunderforest"];

let modalEl = null;
let triggerEl = null;
let pendingFocusProvider = null;

export function initSettingsPanel() {
  modalEl = document.getElementById("settings-modal");
  triggerEl = document.getElementById("open-settings");
  if (!modalEl || !triggerEl) return;

  triggerEl.addEventListener("click", () => openModal());

  // Close affordances: any element marked data-settings-close, plus Escape.
  modalEl.querySelectorAll("[data-settings-close]").forEach((el) => {
    el.addEventListener("click", () => closeModal());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalEl.hidden) closeModal();
  });

  // Per-provider input wiring.
  for (const provider of PROVIDERS) {
    const input = modalEl.querySelector(`[data-key-input="${provider}"]`);
    const reveal = modalEl.querySelector(`[data-reveal-for="${provider}"]`);
    if (!input) continue;

    // Persist on blur. Trim whitespace — pasted keys often have a trailing
    // newline. Empty after trim is treated as "clear" by the store.
    input.addEventListener("blur", () => {
      const value = input.value.trim();
      if (value !== input.value) input.value = value;
      settings.setKey(provider, value);
    });

    // Reveal toggle. We swap input type between password and text rather
    // than reading-and-replacing so the cursor and selection survive.
    if (reveal) {
      reveal.addEventListener("click", () => {
        input.type = input.type === "password" ? "text" : "password";
      });
    }
  }

  // Reflect store state in the UI on every change (and once initially via
  // notify() inside hydrate(), which app.js calls before this init).
  settings.subscribe(renderFromStore);
  renderFromStore(settings.getAllKeys());
}

function renderFromStore(keys) {
  if (!modalEl) return;
  for (const provider of PROVIDERS) {
    const input = modalEl.querySelector(`[data-key-input="${provider}"]`);
    const pill = modalEl.querySelector(`[data-status-for="${provider}"]`);
    const value = keys[provider] ?? "";
    if (input && document.activeElement !== input) {
      // Only sync the input value if the user isn't actively editing it,
      // to avoid clobbering a half-typed key on a notify storm.
      input.value = value;
    }
    if (pill) {
      const isSet = Boolean(value);
      pill.textContent = isSet ? "Set" : "Not set";
      pill.classList.toggle("is-set", isSet);
    }
  }
}

// Open the modal, optionally scrolling to a specific provider's section
// and focusing its input. Used by the picker's locked-row click.
export function openSettingsScrolledTo(provider) {
  pendingFocusProvider = provider;
  openModal();
}

function openModal() {
  if (!modalEl) return;
  modalEl.hidden = false;
  // Scroll to a section if requested + focus its input.
  if (pendingFocusProvider) {
    const section = modalEl.querySelector(
      `[data-provider="${pendingFocusProvider}"]`
    );
    if (section) {
      section.scrollIntoView({ block: "start", behavior: "instant" });
      const input = section.querySelector("[data-key-input]");
      if (input) input.focus();
    }
    pendingFocusProvider = null;
  } else {
    // Default focus: first input.
    const firstInput = modalEl.querySelector("[data-key-input]");
    if (firstInput) firstInput.focus();
  }
}

function closeModal() {
  if (!modalEl) return;
  modalEl.hidden = true;
  pendingFocusProvider = null;
  // Force-flush any pending blur save by blurring the active element. The
  // input's blur handler runs synchronously and persists.
  if (
    document.activeElement &&
    typeof document.activeElement.blur === "function"
  ) {
    document.activeElement.blur();
  }
}
```

- [ ] **Step 2: Wire the settings store and panel from `js/app.js`**

In `js/app.js`, update the import block at the top. Add `import * as settings from "./settings.js";` and `import { initSettingsPanel } from "./settings-panel.js";`. The expected import block becomes:

```js
import {
  initMap,
  renderPins,
  renderRoute,
  getMap,
  setMapStyle,
  MAP_STYLES,
  DEFAULT_MAP_STYLE_ID,
} from "./map.js";
import * as pinStore from "./pins.js";
import * as groupStore from "./groups.js";
import * as settings from "./settings.js";
import {
  attachStorage,
  attachGroupStorage,
  loadMapStyle,
  loadRouteVisible,
  saveRouteVisible,
  loadExportText,
  saveExportText,
  loadExportFormat,
  saveExportFormat,
} from "./storage.js";
import { exportMapAsPng } from "./export.js";
import { exportToJson, importFromJson } from "./backup.js";
import { initSearch } from "./search.js";
import { initPinList } from "./pin-list.js";
import { initGroupPanel } from "./group-panel.js";
import { initSettingsPanel } from "./settings-panel.js";
```

Then inside `init()`, hydrate the settings store **before** any other consumer that might need the keys, and call `initSettingsPanel()` near the other init calls. Specifically:

1. Add `settings.hydrate();` as the first executable line of `init()`, before the `const savedStyleId = loadMapStyle();` line.
2. Add `initSettingsPanel();` after `initBackupControls();` (the last init call in the function).

After your edits, the top of `init()` reads:

```js
function init() {
  // Settings store hydrates first so any consumer that reads keys during
  // boot (token-required style guards, picker render) sees the persisted
  // values. Before this line, getKey() returns "" for all providers.
  settings.hydrate();

  // Resolve the initial style before initMap so the map's first paint is
  // the user's chosen style — no OSM-flash, no extra tile fetches. An
  // unknown saved id (older app version, hand-edited storage) is treated
  // as "no preference" and falls back to the default.
  const savedStyleId = loadMapStyle();
  const initialStyleId = MAP_STYLES.some((s) => s.id === savedStyleId)
    ? savedStyleId
    : DEFAULT_MAP_STYLE_ID;
  // ... rest unchanged
```

And the bottom of `init()` (the existing init-call sequence) gains one new line:

```js
  initExportOptions();
  initExportFormatSelector();
  initExportButton();
  initBackupControls();
  initSettingsPanel();
}
```

- [ ] **Step 3: Verify in browser**

Reload. Click the `⚙` button. Expected:
- Modal opens. Three sections, all "Not set" pills (grey).
- Type `TEST123` into the Stadia field. Tab away (blur). Pill flips to green "Set".
- Click the 👁 next to the Stadia field. Input flips from masked to plain text. Click again — masked again.
- Press Escape. Modal closes.
- Reload. Click ⚙ again. Stadia field shows `TEST123`, pill is green.
- Clear the Stadia field, blur. Pill flips back to grey "Not set". Reload — field is empty.
- Click outside the panel (on the dim backdrop). Modal closes.
- Click `×`. Modal closes.

Verify in DevTools:
```js
console.log(localStorage.getItem('city-pin-map.stadia-key.v1')); // expect: null after clearing
```

- [ ] **Step 4: Commit**

```bash
git add js/settings-panel.js js/app.js
git commit -m "more-styles: settings panel — open, edit, persist, close"
```

---

## Task 6: Picker HTML scaffolding (alongside existing `<select>`) + CSS

**Files:**
- Modify: `index.html` (add `<button id="map-style-trigger">` + popover root, hidden — keep `<select>` for now)
- Modify: `css/styles.css` (popover styles)

The picker remains hidden until Task 8 swaps it in. This task only adds the markup and the CSS.

- [ ] **Step 1: Insert the picker trigger button + popover root in `index.html`**

Find the existing `<select id="map-style-select">` block (currently around lines 64-68). Leave it as-is and insert the new picker markup *immediately after* it (still inside the `<header class="app-header">`):

```html
<select
  id="map-style-select"
  class="map-style-select"
  aria-label="Map style"
></select>
<!-- New picker — Task 6, hidden until Task 8 takes over from <select>. -->
<div id="map-style-picker" class="picker" data-picker-state="closed" hidden>
  <button
    id="map-style-trigger"
    type="button"
    class="picker__trigger"
    aria-haspopup="listbox"
    aria-expanded="false"
    aria-controls="map-style-popover"
  >
    <span class="picker__trigger-prefix">Map:</span>
    <span class="picker__trigger-label" id="map-style-trigger-label">…</span>
    <span class="picker__chevron" aria-hidden="true">▾</span>
  </button>
  <div
    id="map-style-popover"
    class="picker__popover"
    role="listbox"
    aria-labelledby="map-style-trigger"
    hidden
  >
    <input
      type="search"
      id="map-style-search"
      class="picker__search"
      placeholder="Search styles…"
      autocomplete="off"
      spellcheck="false"
      aria-label="Search styles"
    />
    <ul id="map-style-list" class="picker__list" role="presentation"></ul>
    <footer class="picker__footer">
      <button
        type="button"
        class="picker__manage-keys"
        id="picker-manage-keys"
      >
        ⚙ Manage API keys
      </button>
    </footer>
  </div>
</div>
```

The outer `<div id="map-style-picker">` has `hidden` so it's not visible during this task.

- [ ] **Step 2: Append picker CSS to `css/styles.css`**

Append at the bottom of the file:

```css
/* ===== Style picker popover (Task 6 — More basemap styles) ===== */

.picker { position: relative; }

.picker__trigger {
  appearance: none;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0.4rem 0.75rem;
  font-size: 0.9rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 12rem;
  text-align: left;
  color: #0f172a;
}
.picker__trigger:hover { border-color: #94a3b8; }
.picker__trigger[aria-expanded="true"] {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.picker__trigger-prefix {
  color: #64748b;
  font-size: 0.8rem;
}
.picker__trigger-label { flex: 1; font-weight: 500; }
.picker__chevron { color: #64748b; }

.picker__popover[hidden] { display: none; }
.picker__popover {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  width: 360px;
  max-height: 480px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  z-index: 200;
  overflow: hidden;
}

.picker__search {
  border: 0;
  border-bottom: 1px solid #e2e8f0;
  padding: 0.55rem 0.8rem;
  font-size: 0.9rem;
  outline: none;
}
.picker__search:focus {
  background: #f8fafc;
}

.picker__list {
  list-style: none;
  margin: 0;
  padding: 0.25rem 0;
  overflow-y: auto;
  flex: 1;
}

.picker__group-header {
  padding: 0.4rem 0.8rem 0.2rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
}

.picker__row {
  padding: 0.4rem 0.8rem;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  font-size: 0.9rem;
  color: #0f172a;
}
.picker__row:hover { background: #f1f5f9; }
.picker__row[aria-selected="true"] {
  background: #e0e7ff;
  font-weight: 600;
}
.picker__row.is-active-key {
  background: #f1f5f9;
}

.picker__row-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.picker__row-label { flex: 1; }

.picker__row.is-locked {
  color: #94a3b8;
  cursor: pointer;
}
.picker__row.is-locked .picker__row-label::after {
  content: " 🔒";
  font-size: 0.85em;
}

.picker__empty {
  padding: 0.6rem 0.8rem;
  color: #94a3b8;
  font-size: 0.85rem;
}

.picker__footer {
  border-top: 1px solid #e2e8f0;
  padding: 0.35rem 0.5rem;
  display: flex;
  justify-content: flex-end;
}

.picker__manage-keys {
  appearance: none;
  background: transparent;
  border: 0;
  font-size: 0.8rem;
  color: #2563eb;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
}
.picker__manage-keys:hover { text-decoration: underline; }

/* When the picker takes over from <select>, hide the old element. */
.map-style-select.is-replaced { display: none; }
```

- [ ] **Step 3: Verify in browser**

Reload. Expected:
- Header looks identical to before — the `<select>` is still active, the new picker is hidden.
- In DevTools console, force-show the picker:
  ```js
  document.getElementById('map-style-picker').hidden = false;
  document.getElementById('map-style-popover').hidden = false;
  ```
  → both the trigger button and the popover appear. The popover is empty (no rows yet — Task 7 builds the renderer). Search input and footer are visible.
- Hide them again:
  ```js
  document.getElementById('map-style-picker').hidden = true;
  document.getElementById('map-style-popover').hidden = true;
  ```

- [ ] **Step 4: Commit**

```bash
git add index.html css/styles.css
git commit -m "more-styles: picker scaffolding — markup + css"
```

---

## Task 7: Create `js/style-picker.js` module

**Files:**
- Create: `js/style-picker.js`

The module is built but not wired in `app.js` yet — Task 8 wires it. This task is testable by manual call from DevTools.

- [ ] **Step 1: Create `js/style-picker.js` with the full contents below**

```js
// js/style-picker.js — Searchable, grouped popover for selecting a basemap.
//
// Replaces the native <select id="map-style-select">. Built from MAP_STYLES;
// groups by .provider; locked rows (token-required, no key set) route the
// click to the settings modal scrolled to that provider's section.
//
// Public API:
//   initStylePicker({ getCurrentStyleId, onSelect, onOpenSettings })
//     → returns { setActive(styleId) } so the caller can update the
//       trigger label + active row when a style is set externally
//       (boot, failed-swap revert, etc).
//
// Keyboard nav: Arrows traverse rows; Enter selects; Tab focuses search;
// Escape closes; click-outside closes.

import { MAP_STYLES } from "./map.js";
import * as settings from "./settings.js";

const PROVIDER_ORDER = [
  "openfreemap",
  "stadia",
  "maptiler",
  "thunderforest",
  "wikimedia",
  "opentopomap",
  "esri",
];

const PROVIDER_LABEL = {
  openfreemap: "OpenFreeMap (vector)",
  stadia: "Stadia",
  maptiler: "MapTiler",
  thunderforest: "Thunderforest",
  wikimedia: "Wikimedia (raster)",
  opentopomap: "OpenTopoMap (raster)",
  esri: "Esri (raster)",
};

const PROVIDER_COLOR = {
  openfreemap: "#22c55e",
  stadia: "#0f172a",
  maptiler: "#2563eb",
  thunderforest: "#16a34a",
  wikimedia: "#a855f7",
  opentopomap: "#f97316",
  esri: "#0ea5e9",
};

const SEARCH_DEBOUNCE_MS = 100;

let pickerEl = null;
let triggerEl = null;
let triggerLabelEl = null;
let popoverEl = null;
let searchEl = null;
let listEl = null;
let manageKeysBtn = null;

let currentSearch = "";
let searchTimer = null;
let activeStyleId = null;
let onSelectCb = null;
let onOpenSettingsCb = null;
let isOpen = false;

export function initStylePicker({
  getCurrentStyleId,
  onSelect,
  onOpenSettings,
}) {
  pickerEl = document.getElementById("map-style-picker");
  triggerEl = document.getElementById("map-style-trigger");
  triggerLabelEl = document.getElementById("map-style-trigger-label");
  popoverEl = document.getElementById("map-style-popover");
  searchEl = document.getElementById("map-style-search");
  listEl = document.getElementById("map-style-list");
  manageKeysBtn = document.getElementById("picker-manage-keys");

  if (
    !pickerEl ||
    !triggerEl ||
    !triggerLabelEl ||
    !popoverEl ||
    !searchEl ||
    !listEl ||
    !manageKeysBtn
  ) {
    return { setActive: () => {} };
  }

  onSelectCb = onSelect;
  onOpenSettingsCb = onOpenSettings;

  // Reveal the picker (it's hidden in markup until JS attaches handlers).
  pickerEl.hidden = false;

  // Initial active id + trigger label.
  setActive(getCurrentStyleId());

  // Wire interactions.
  triggerEl.addEventListener("click", toggle);
  searchEl.addEventListener("input", onSearchInput);
  searchEl.addEventListener("keydown", onSearchKeydown);
  manageKeysBtn.addEventListener("click", () => {
    close();
    if (onOpenSettingsCb) onOpenSettingsCb(null);
  });
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onDocumentKeydown);

  // Re-render rows whenever the settings store changes — locked rows
  // unlock when their key is set, and vice-versa.
  settings.subscribe(() => {
    if (isOpen) renderRows();
  });

  return { setActive };
}

function setActive(styleId) {
  activeStyleId = styleId;
  const entry = MAP_STYLES.find((s) => s.id === styleId);
  if (triggerLabelEl) {
    triggerLabelEl.textContent = entry ? entry.label : "—";
  }
  if (isOpen) renderRows();
}

function toggle() {
  if (isOpen) close();
  else open();
}

function open() {
  if (isOpen) return;
  isOpen = true;
  popoverEl.hidden = false;
  triggerEl.setAttribute("aria-expanded", "true");
  pickerEl.dataset.pickerState = "open";
  renderRows();
  // Focus the search field for instant typing.
  searchEl.focus();
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  popoverEl.hidden = true;
  triggerEl.setAttribute("aria-expanded", "false");
  pickerEl.dataset.pickerState = "closed";
  searchEl.value = "";
  currentSearch = "";
}

function onDocumentClick(e) {
  if (!isOpen) return;
  if (pickerEl.contains(e.target)) return;
  close();
}

function onDocumentKeydown(e) {
  if (!isOpen) return;
  if (e.key === "Escape") {
    close();
    triggerEl.focus();
  }
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentSearch = searchEl.value.trim().toLowerCase();
    renderRows();
  }, SEARCH_DEBOUNCE_MS);
}

function onSearchKeydown(e) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const firstRow = listEl.querySelector(".picker__row");
    if (firstRow) firstRow.focus();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const firstRow = listEl.querySelector(".picker__row");
    if (firstRow) firstRow.click();
  }
}

function renderRows() {
  if (!listEl) return;

  // Build a fresh DocumentFragment, then atomically swap children.
  // Avoids assigning innerHTML (and any XSS surface) and avoids the
  // visible reflow churn of clearing + appending one node at a time.
  const frag = document.createDocumentFragment();
  const filtered = MAP_STYLES.filter((entry) => matches(entry, currentSearch));

  // Group by provider, in PROVIDER_ORDER. Unknown providers fall to a
  // trailing bucket so a typo in MAP_STYLES still renders the row.
  const groups = new Map();
  for (const provider of PROVIDER_ORDER) groups.set(provider, []);
  for (const entry of filtered) {
    if (!groups.has(entry.provider)) groups.set(entry.provider, []);
    groups.get(entry.provider).push(entry);
  }

  for (const [provider, entries] of groups) {
    if (entries.length === 0) continue;
    frag.appendChild(renderGroupHeader(provider));
    for (const entry of entries) {
      frag.appendChild(renderRow(entry));
    }
  }

  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "picker__empty";
    empty.textContent = "No styles match.";
    frag.appendChild(empty);
  }

  // Atomic swap. replaceChildren() removes existing children and inserts
  // the fragment in one go — no innerHTML, no incremental flicker.
  listEl.replaceChildren(frag);
}

function matches(entry, query) {
  if (!query) return true;
  return (
    entry.label.toLowerCase().includes(query) ||
    (entry.provider && entry.provider.toLowerCase().includes(query))
  );
}

function renderGroupHeader(provider) {
  const li = document.createElement("li");
  li.className = "picker__group-header";
  li.setAttribute("role", "presentation");
  li.textContent = PROVIDER_LABEL[provider] ?? provider;
  return li;
}

function renderRow(entry) {
  const li = document.createElement("li");
  li.className = "picker__row";
  li.setAttribute("role", "option");
  li.setAttribute("tabindex", "0");
  li.dataset.styleId = entry.id;

  const locked =
    entry.requiresToken && !settings.isProviderUnlocked(entry.requiresToken);
  if (locked) li.classList.add("is-locked");
  if (entry.id === activeStyleId) {
    li.classList.add("is-active-key");
    li.setAttribute("aria-selected", "true");
  }

  const dot = document.createElement("span");
  dot.className = "picker__row-dot";
  dot.style.background = PROVIDER_COLOR[entry.provider] ?? "#94a3b8";
  li.appendChild(dot);

  const label = document.createElement("span");
  label.className = "picker__row-label";
  label.textContent = entry.label;
  li.appendChild(label);

  li.addEventListener("click", () => {
    if (locked) {
      close();
      if (onOpenSettingsCb) onOpenSettingsCb(entry.requiresToken);
      return;
    }
    setActive(entry.id);
    close();
    if (onSelectCb) onSelectCb(entry.id);
  });
  li.addEventListener("keydown", (e) => onRowKeydown(e, li));

  return li;
}

function onRowKeydown(e, li) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    li.click();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = li.nextElementSibling;
    if (!next) return;
    if (next.classList.contains("picker__group-header")) {
      const nextRow = next.nextElementSibling;
      if (nextRow) nextRow.focus();
    } else {
      next.focus();
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = li.previousElementSibling;
    if (!prev) {
      searchEl.focus();
      return;
    }
    if (prev.classList.contains("picker__group-header")) {
      const prevRow = prev.previousElementSibling;
      if (prevRow) prevRow.focus();
      else searchEl.focus();
    } else {
      prev.focus();
    }
  }
}
```

- [ ] **Step 2: Verify in browser (manual call from DevTools)**

Reload. The picker is still hidden (Task 8 wires it formally). In DevTools console:

```js
const picker = await import('./js/style-picker.js');
const handle = picker.initStylePicker({
  getCurrentStyleId: () => 'osm',
  onSelect: (id) => console.log('SELECTED:', id),
  onOpenSettings: (provider) => console.log('OPEN SETTINGS for:', provider),
});
```

Expected:
- The picker trigger button appears in the header.
- Clicking it opens the popover. The popover lists 7 styles (the existing 7 keyless ones — Task 8 will add the new entries). All 7 are unlocked since none require tokens yet.
- Type `dark` in the search → only `Dark` row remains.
- Click `Dark` → console logs `SELECTED: carto-dark`. Trigger label updates to `Dark`. Popover closes.
- Click trigger again → popover opens. Press `↓` → first row gains focus. Arrow nav works.
- Press Escape → popover closes, trigger is focused.
- Click `⚙ Manage API keys` in footer → console logs `OPEN SETTINGS for: null`. Popover closes.

(The old `<select>` is still also visible — that's fine; Task 8 hides it.)

- [ ] **Step 3: Commit**

```bash
git add js/style-picker.js
git commit -m "more-styles: style-picker module with search + keyboard nav"
```

---

## Task 8: Expand `MAP_STYLES`, swap `<select>` → picker

**Files:**
- Modify: `js/map.js` (backfill `provider` on existing 7 entries; add ~22 new entries)
- Modify: `index.html` (remove `<select id="map-style-select">`)
- Modify: `js/app.js` (replace `initMapStyleSelector` with `initStylePicker` + wire to settings panel)

This is the biggest task. After this, the picker is the sole map-style affordance and 29 styles are exposed.

> **Implementation note (carried from spec):** The provider URL templates below are the author's best-known shapes at plan-write time. Before pasting them as final, verify each one with the provider's current docs and a smoke-test fetch — provider style ids do drift (e.g. MapTiler often promotes styles to `-v2` suffixes). Adjust the `style:` URL accordingly. The `provider` and `requiresToken` fields stay the same regardless.

- [ ] **Step 1: Backfill `provider` on the existing 7 `MAP_STYLES` entries in `js/map.js`**

For each of the 7 entries currently in `MAP_STYLES`, add a `provider` field. The change for each:

```js
// osm
{ id: "osm", label: "OSM Standard", provider: "openfreemap", style: "https://tiles.openfreemap.org/styles/liberty" },
// carto-light
{ id: "carto-light", label: "Light", provider: "openfreemap", style: "https://tiles.openfreemap.org/styles/positron" },
// carto-dark
{ id: "carto-dark", label: "Dark", provider: "openfreemap", style: "https://tiles.openfreemap.org/styles/dark" },
// carto-voyager
{ id: "carto-voyager", label: "Voyager", provider: "openfreemap", style: "https://tiles.openfreemap.org/styles/bright" },
// wikimedia → provider: "wikimedia"
// topo → provider: "opentopomap"
// esri-imagery → provider: "esri"
```

Edit each entry's literal in place — only the new `provider` field is added; everything else (id, label, style) stays as-is. Don't restructure the file beyond this.

- [ ] **Step 2: Append the new entries to `MAP_STYLES` (Stadia 6, MapTiler 10, Thunderforest 6)**

Add these entries inside the `MAP_STYLES` array, after the existing 7 (still inside the closing `];`). Paste verbatim:

```js
  // Stadia Maps — token-required vector styles. Free tier: 200K req/mo.
  {
    id: "stadia-stamen-watercolor",
    label: "Stamen Watercolor",
    provider: "stadia",
    requiresToken: "stadia",
    style:
      "https://tiles.stadiamaps.com/styles/stamen_watercolor.json?api_key={api_key}",
  },
  {
    id: "stadia-stamen-toner",
    label: "Stamen Toner",
    provider: "stadia",
    requiresToken: "stadia",
    style:
      "https://tiles.stadiamaps.com/styles/stamen_toner.json?api_key={api_key}",
  },
  {
    id: "stadia-stamen-toner-lite",
    label: "Stamen Toner Lite",
    provider: "stadia",
    requiresToken: "stadia",
    style:
      "https://tiles.stadiamaps.com/styles/stamen_toner_lite.json?api_key={api_key}",
  },
  {
    id: "stadia-stamen-terrain",
    label: "Stamen Terrain",
    provider: "stadia",
    requiresToken: "stadia",
    style:
      "https://tiles.stadiamaps.com/styles/stamen_terrain.json?api_key={api_key}",
  },
  {
    id: "stadia-alidade-smooth",
    label: "Alidade Smooth",
    provider: "stadia",
    requiresToken: "stadia",
    style:
      "https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key={api_key}",
  },
  {
    id: "stadia-alidade-smooth-dark",
    label: "Alidade Smooth Dark",
    provider: "stadia",
    requiresToken: "stadia",
    style:
      "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key={api_key}",
  },

  // MapTiler — token-required vector styles. Free tier: 100K req/mo.
  {
    id: "maptiler-streets",
    label: "Streets",
    provider: "maptiler",
    requiresToken: "maptiler",
    style:
      "https://api.maptiler.com/maps/streets-v2/style.json?key={api_key}",
  },
  {
    id: "maptiler-outdoor",
    label: "Outdoor",
    provider: "maptiler",
    requiresToken: "maptiler",
    style:
      "https://api.maptiler.com/maps/outdoor-v2/style.json?key={api_key}",
  },
  {
    id: "maptiler-winter",
    label: "Winter",
    provider: "maptiler",
    requiresToken: "maptiler",
    style:
      "https://api.maptiler.com/maps/winter-v2/style.json?key={api_key}",
  },
  {
    id: "maptiler-backdrop",
    label: "Backdrop",
    provider: "maptiler",
    requiresToken: "maptiler",
    style:
      "https://api.maptiler.com/maps/backdrop/style.json?key={api_key}",
  },
  {
    id: "maptiler-pastel",
    label: "Pastel",
    provider: "maptiler",
    requiresToken: "maptiler",
    style: "https://api.maptiler.com/maps/pastel/style.json?key={api_key}",
  },
  {
    id: "maptiler-bright",
    label: "Bright",
    provider: "maptiler",
    requiresToken: "maptiler",
    style: "https://api.maptiler.com/maps/bright-v2/style.json?key={api_key}",
  },
  {
    id: "maptiler-dataviz",
    label: "Dataviz",
    provider: "maptiler",
    requiresToken: "maptiler",
    style: "https://api.maptiler.com/maps/dataviz/style.json?key={api_key}",
  },
  {
    id: "maptiler-topo",
    label: "Topo",
    provider: "maptiler",
    requiresToken: "maptiler",
    style: "https://api.maptiler.com/maps/topo-v2/style.json?key={api_key}",
  },
  {
    id: "maptiler-hybrid",
    label: "Satellite Hybrid",
    provider: "maptiler",
    requiresToken: "maptiler",
    style: "https://api.maptiler.com/maps/hybrid/style.json?key={api_key}",
  },
  {
    id: "maptiler-aquarelle",
    label: "Aquarelle",
    provider: "maptiler",
    requiresToken: "maptiler",
    style: "https://api.maptiler.com/maps/aquarelle/style.json?key={api_key}",
  },

  // Thunderforest — token-required raster styles. Free tier: 150K req/mo.
  // Wrapped via rasterStyle() so they ride the existing raster path; the
  // `{api_key}` placeholder in the tiles URL is substituted by
  // resolveStyleUrl() at swap time.
  {
    id: "tf-cycle",
    label: "OpenCycleMap",
    provider: "thunderforest",
    requiresToken: "thunderforest",
    style: rasterStyle({
      tiles: ["https://tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey={api_key}"],
      maxzoom: 22,
      attribution:
        'Maps © <a href="https://www.thunderforest.com">Thunderforest</a> | Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  },
  {
    id: "tf-transport",
    label: "Transport",
    provider: "thunderforest",
    requiresToken: "thunderforest",
    style: rasterStyle({
      tiles: ["https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey={api_key}"],
      maxzoom: 22,
      attribution:
        'Maps © <a href="https://www.thunderforest.com">Thunderforest</a> | Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  },
  {
    id: "tf-landscape",
    label: "Landscape",
    provider: "thunderforest",
    requiresToken: "thunderforest",
    style: rasterStyle({
      tiles: ["https://tile.thunderforest.com/landscape/{z}/{x}/{y}.png?apikey={api_key}"],
      maxzoom: 22,
      attribution:
        'Maps © <a href="https://www.thunderforest.com">Thunderforest</a> | Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  },
  {
    id: "tf-atlas",
    label: "Atlas",
    provider: "thunderforest",
    requiresToken: "thunderforest",
    style: rasterStyle({
      tiles: ["https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey={api_key}"],
      maxzoom: 22,
      attribution:
        'Maps © <a href="https://www.thunderforest.com">Thunderforest</a> | Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  },
  {
    id: "tf-outdoors",
    label: "Outdoors",
    provider: "thunderforest",
    requiresToken: "thunderforest",
    style: rasterStyle({
      tiles: ["https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={api_key}"],
      maxzoom: 22,
      attribution:
        'Maps © <a href="https://www.thunderforest.com">Thunderforest</a> | Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  },
  {
    id: "tf-pioneer",
    label: "Pioneer",
    provider: "thunderforest",
    requiresToken: "thunderforest",
    style: rasterStyle({
      tiles: ["https://tile.thunderforest.com/pioneer/{z}/{x}/{y}.png?apikey={api_key}"],
      maxzoom: 22,
      attribution:
        'Maps © <a href="https://www.thunderforest.com">Thunderforest</a> | Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  },
```

- [ ] **Step 3: Verify URL templates against current provider docs (do BEFORE moving on)**

For each provider, open the docs in a browser tab and confirm the style ids and URL shapes match the entries above. If any differ, update the corresponding entry's `style` value to match. Do not change `provider` or `requiresToken`.

- Stadia: <https://docs.stadiamaps.com/themes/>
- MapTiler: <https://docs.maptiler.com/cloud/api/maps/>
- Thunderforest: <https://www.thunderforest.com/api/>

- [ ] **Step 4: Remove the old `<select>` from `index.html`**

Delete the existing `<select id="map-style-select">` element (currently around lines 64-68) and the `<label for="map-style-select">` immediately above it. Leave the new picker markup (added in Task 6) where it is — Task 7's `pickerEl.hidden = false;` will reveal it on init.

- [ ] **Step 5: Replace `initMapStyleSelector` with `initStylePicker` in `js/app.js`**

Add the imports at the top:

```js
import { initStylePicker } from "./style-picker.js";
import { openSettingsScrolledTo } from "./settings-panel.js";
```

Delete the entire existing `initMapStyleSelector` function (currently around lines 164-179).

In `init()`, replace the `initMapStyleSelector(initialStyleId);` call (currently around line 43) with:

```js
  const pickerHandle = initStylePicker({
    getCurrentStyleId: () => initialStyleId,
    onSelect: (id) => setMapStyle(id),
    onOpenSettings: (provider) => {
      // null provider = generic "Manage API keys" footer click; default
      // to the first section (Stadia).
      openSettingsScrolledTo(provider ?? "stadia");
    },
  });
```

`pickerHandle` is intentionally left unused for now — it exposes `setActive(id)` for future cross-tab sync if you want to wire `window.addEventListener("storage", …)` later, but that's not part of this plan's scope.

- [ ] **Step 6: Verify in browser**

Reload. Expected:
- The native `<select>` is gone.
- The picker trigger button reads `Map: <name of currently active style>` and a chevron.
- Click trigger → popover opens with **29 styles**, grouped: OpenFreeMap (4), Stadia (6), MapTiler (10), Thunderforest (6), Wikimedia (1), OpenTopoMap (1), Esri (1).
- All Stadia / MapTiler / Thunderforest rows show as **locked** (greyed, lock icon) since no keys are set.
- Click a locked Stadia row → popover closes, settings modal opens scrolled to the Stadia section.
- Close modal. Click trigger → popover opens. Click a keyless row (e.g. `Dark`) → popover closes, map swaps to Dark, trigger label updates.
- Search `aqua` → only `Aquarelle` shown (locked).
- Click footer `⚙ Manage API keys` → settings modal opens.

If you have a real Stadia API key, paste it into the Stadia field, blur the input, close the modal, open the picker — the Stadia rows should now be unlocked. Click `Stamen Watercolor` — the map should paint the Stamen Watercolor style. (If you don't have a key yet, this verification step is partial — the failure-mode tests in Task 11 cover the bad-key path.)

- [ ] **Step 7: Commit**

```bash
git add js/map.js index.html js/app.js
git commit -m "more-styles: 22 new entries + select→picker swap"
```

---

## Task 9: Boot-time hydration order + missing-key guard

**Files:**
- Modify: `js/app.js` (extend the existing initial-style-resolution block to skip token-required styles whose key is missing)

The settings store already hydrates first (Task 5). This task adds the boot guard: if the persisted style is token-required and its key is missing (e.g. user cleared it on a previous session), fall back to the default and show a banner.

- [ ] **Step 1: Replace the `initialStyleId` resolution block in `js/app.js`**

Find the existing block in `init()` (currently around lines 37-40 after Task 5's edits):

```js
  const savedStyleId = loadMapStyle();
  const initialStyleId = MAP_STYLES.some((s) => s.id === savedStyleId)
    ? savedStyleId
    : DEFAULT_MAP_STYLE_ID;
```

Replace with:

```js
  const savedStyleId = loadMapStyle();
  const savedEntry = MAP_STYLES.find((s) => s.id === savedStyleId);
  let initialStyleId;
  if (!savedEntry) {
    initialStyleId = DEFAULT_MAP_STYLE_ID;
  } else if (
    savedEntry.requiresToken &&
    !settings.isProviderUnlocked(savedEntry.requiresToken)
  ) {
    // The persisted choice requires a token whose key isn't set anymore.
    // Fall back to the default so the boot path is always paintable. Show
    // a banner so the user knows why their preferred style isn't loading.
    showError(
      `${savedEntry.label} needs a ${savedEntry.requiresToken} API key. Open Settings (⚙ in side panel) to add one.`
    );
    initialStyleId = DEFAULT_MAP_STYLE_ID;
  } else {
    initialStyleId = savedStyleId;
  }
```

Add `showError` to the existing `./storage.js` import block at the top of `app.js`. The expected import line:

```js
import {
  attachStorage,
  attachGroupStorage,
  loadMapStyle,
  loadRouteVisible,
  saveRouteVisible,
  loadExportText,
  saveExportText,
  loadExportFormat,
  saveExportFormat,
  showError,
} from "./storage.js";
```

- [ ] **Step 2: Verify in browser**

Reload. The missing-key guard fires only when a token-required style is the persisted preference. Two scenarios:

(a) **Normal boot (no token-required style persisted)** — App boots silently into the default OSM style. No banner.

(b) **Force the guard with a stale-state simulation** — In DevTools console, before reloading:

```js
localStorage.setItem('city-pin-map.map-style.v1', 'stadia-stamen-watercolor');
localStorage.removeItem('city-pin-map.stadia-key.v1');
location.reload();
```

Expected on reload: the app boots into the default OSM style, AND the red banner at the bottom reads `Stamen Watercolor needs a stadia API key. Open Settings (⚙ in side panel) to add one.`

Clean up:
```js
localStorage.setItem('city-pin-map.map-style.v1', 'osm');
location.reload();
```

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "more-styles: boot guard for missing-key persisted style"
```

---

## Task 10: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (replace hard rule #3; append the new feature to "What's shipped")

The user has uncommitted edits to `CLAUDE.md` from prior sessions. Take care to integrate cleanly — read the file first and merge instead of overwriting.

- [ ] **Step 1: Replace hard rule #3**

Open `CLAUDE.md`. Find the "Hard rules" section. The current rule #3 reads:

```
3. **No paid APIs.** Use Leaflet + OpenStreetMap + Nominatim. None require an API key.
```

Replace it with:

```
3. **No paid APIs.** Use MapLibre GL JS + OpenStreetMap + Nominatim. Free-tier API keys (Stadia, MapTiler, Thunderforest) are allowed; no paid plans, ever. Keys live in `localStorage` per-user — never inlined in source, never committed to git, never included in JSON backup exports.
```

(This edit also corrects the stale "Leaflet" reference, which has been wrong since HARDEN-012 cutover.)

- [ ] **Step 2: Append the new feature line under "What's shipped"**

Find the "What's shipped (as of 2026-05-08)" section. Append a new bullet describing the addition (mirroring the existing bullet style):

```
- Expanded basemap registry (this milestone): 22 additional styles across three free-tier providers (Stadia for Stamen Watercolor/Toner family, MapTiler for the modern catalog incl. Satellite Hybrid, Thunderforest for cycling/transit/landscape). Native `<select>` replaced by a searchable popover picker (`js/style-picker.js`); per-provider API keys live in a settings modal (`js/settings-panel.js`) backed by a new pub/sub store (`js/settings.js`). Style swaps now route through `setStyleSafely()` which races `styledata` (success) vs `error` (failure) with a 5s timeout — failed swaps revert to the previously-rendered style without persisting the bad choice, so reload always boots into a known-working state.
```

- [ ] **Step 3: Verify**

Reload `CLAUDE.md` in your editor. Confirm:
- Hard rule #3 reads as updated.
- "What's shipped" has the new bullet.
- No accidental duplicate of an existing bullet (the user's pre-existing CLAUDE.md edits may have changed adjacent content — eyeball the diff).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "more-styles: claude.md rule #3 + what's-shipped"
```

---

## Task 11: Manual acceptance test pass

**Files:**
- No code changes. This task is the spec's "Acceptance test plan" run end-to-end.

This is the spec's checklist (`docs/superpowers/specs/2026-05-08-more-basemap-styles-design.md` § "Acceptance test plan"). Run each item in a fresh browser session. If any fails, fix the cause in a small follow-up commit before marking the task complete.

You will need real free-tier keys for the failure-mode and PNG-export checks — sign up at the three providers if you haven't already.

- [ ] **Setup**
  - [ ] Open `index.html` (or via `start.command`). No console errors. ⚙ button visible in side panel. Style picker visible in header.
  - [ ] Click style picker → popover lists 29 styles grouped by provider. Locked styles greyed with lock icon.

- [ ] **Settings flow**
  - [ ] Click ⚙ → modal opens, 3 sections, all "Not set" (grey pill).
  - [ ] Paste a valid Stadia key → blur → pill turns green. Reload → still green.
  - [ ] Clear field → blur → pill turns grey. Reload → still grey, field empty.
  - [ ] Signup link opens provider page in new tab.

- [ ] **Picker flow**
  - [ ] Type "watercolor" in search → only Stamen Watercolor visible.
  - [ ] Arrow keys navigate from search down through rows; Enter selects; Escape closes; click-outside closes.
  - [ ] Click locked row (e.g. MapTiler Streets while MapTiler key is empty) → settings modal opens scrolled to MapTiler section.
  - [ ] Footer "⚙ Manage API keys" link → settings modal opens.

- [ ] **Map style swap**
  - [ ] Switch to Stamen Watercolor → renders correctly. Drop a couple of pins (search or click). Switch to MapTiler Streets → pins preserved across swap. Toggle route on, switch styles again — route polyline preserved.
  - [ ] Reload → app boots into the most recent successful style.
  - [ ] Switch to a Thunderforest style (e.g. OpenCycleMap) → renders.

- [ ] **Failure modes** (each should surface a banner + revert picker)
  - [ ] Set a deliberately wrong Stadia key → pick Stadia Watercolor → banner `"Stadia rejected the API key. Verify it in Settings."` + map reverts to previous style + picker label reverts.
  - [ ] Clear Stadia key while Stadia style is active + reload → banner `"Stamen Watercolor needs a stadia API key. …"` + boots into default style.
  - [ ] Use DevTools Network tab to throttle to "Offline", pick a token-required style → after ~5s, banner `"Failed to load style. Check your connection."` + revert.

- [ ] **PNG export (regression)**
  - [ ] Export with Stamen Watercolor backdrop → image renders correctly with title bar.
  - [ ] Export with MapTiler Satellite Hybrid → image renders correctly.
  - [ ] Export with default OSM Standard → unchanged from before (no regression).

- [ ] **Backup/restore (security)**
  - [ ] Export JSON → open the downloaded file in a text editor → verify it contains `pins` and `groups` keys but **does NOT** contain any of `stadia`, `maptiler`, `thunderforest`, or `api_key`.
  - [ ] In a fresh browser profile (or after clearing all localStorage), import the JSON → pins/groups restored; API keys remain unset; locked rows are still locked.

- [ ] **Final commit (optional — only if you've made fix-up edits during this pass)**

```bash
git add -A
git commit -m "more-styles: fix-ups from acceptance pass"
```

---

## Self-review checklist

**1. Spec coverage** — every spec section maps to a task:
- §1 Data model + persistence → T1 (storage primitives), T2 (settings store), T8 (registry expansion)
- §2 UI surfaces → T4 (settings modal scaffolding), T5 (settings panel JS), T6 (picker scaffolding), T7 (picker JS), T8 (swap)
- §3 Runtime behavior → T3 (resolveStyleUrl + setStyleSafely semantics), T9 (boot guard)
- §4 Files/process/test plan → T8 (file changes), T10 (CLAUDE.md), T11 (acceptance test)

**2. Type/identifier consistency:**
- The export name `setMapStyle` in `js/map.js` is intentionally **not renamed** even though its body becomes "setStyleSafely semantics" — keeps the existing `app.js` import (`import { setMapStyle } from "./map.js"`) intact and avoids touching unrelated import sites.
- `settings.isProviderUnlocked()` is referenced in T7 (style-picker) and T9 (boot guard) — both consistent with the implementation in T2.
- `openSettingsScrolledTo(provider)` is exported from `js/settings-panel.js` (T5) and called from `js/app.js` (T8 wiring).
- `resolveStyleUrl(entry)` is module-private to `js/map.js` (T3) — only `setMapStyle` calls it.

**3. Placeholder scan:** All code blocks contain real code. No "TBD", "TODO", or "implement later". The only deliberate flag is the implementation note in T8 Step 3 about confirming provider URL templates — this is a verification instruction, not a placeholder.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-more-basemap-styles.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
