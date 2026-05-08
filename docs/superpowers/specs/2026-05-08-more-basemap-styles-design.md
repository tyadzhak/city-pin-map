# More basemap styles — design

| Field | Value |
|---|---|
| **Date** | 2026-05-08 |
| **Status** | Draft (pending implementation plan) |
| **Related** | HARDEN-007 (basemap variety, original 7-style set), HARDEN-009..012 (MapLibre cutover that enabled vector styles) |

## Problem

The app ships 7 basemaps today (4 OpenFreeMap vector styles + Wikimedia / OpenTopoMap / Esri Satellite). The user finds this insufficient on two axes:

1. **Variety** — substantially more options needed.
2. **Aesthetics** — none of the current options scratch the "decorative / artistic map" itch (e.g., Stamen Watercolor, Stamen Toner).

The candidate-pool size is gated by whether free-tier API keys (Stadia / MapTiler / Thunderforest) are permitted. The current `CLAUDE.md` hard rule #3 forbids API keys outright; relaxing it from "no paid APIs" to "no paid plans" unlocks 50+ professionally-designed styles across three providers — including the Stamen family that defines the aesthetic the user is looking for.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| API key boundary | **Allow free-tier keys** (Stadia, MapTiler, Thunderforest) | Keyless pool is too small to address the aesthetic complaint; free-tier providers host Stamen Watercolor + a wide modern catalog. Friction is one signup per provider. |
| Curation | ~22 new styles across all 3 providers | Maximum-variety approach. Picker UI is rebuilt to handle the size; native `<select>` doesn't scale past ~15 items. |
| Key storage | `localStorage` per-user — never inlined in source, never in JSON backup | Source remains shareable; account stays private. Same trust model as every other preference in the app. |
| Picker UI | Custom searchable popover (replaces native `<select>`) | Modal too heavyweight for a high-frequency action; native `<select>` doesn't support search, lock indicators, or grouped headers cleanly. |
| Settings UI | New modal triggered by ⚙ button in side panel | Header is already saturated; modal cleanly separates configuration from primary affordances. |
| Style thumbnails | **Deferred** — text-only rows in v1 | Generating/hosting thumbnails for 29 styles is its own project. Out of scope. |
| Custom style URL paste (option C) | **Deferred** | Settings infrastructure built here makes it cheap to add later. Out of scope. |
| Validation Test button | Omitted | Invalid keys reveal themselves on first style load via existing `showError()`; duplicating that path adds code without changing outcome. |

## §1 — Data model and persistence

### Registry shape (`js/map.js` `MAP_STYLES`)

Each entry grows by 2 optional fields. Backfill the existing 7 entries with `provider` only (they have no token requirement).

```js
{
  id: 'stamen-watercolor',
  label: 'Watercolor',
  provider: 'stadia',              // new — used for grouping in picker + key lookup
  requiresToken: 'stadia',          // new — optional; absent for keyless 7
  style: 'https://tiles.stadiamaps.com/styles/stamen_watercolor.json?api_key={api_key}'
}
```

- `provider` ∈ `openfreemap | wikimedia | opentopomap | esri | stadia | maptiler | thunderforest`.
- `requiresToken` names the provider whose key is substituted into `{api_key}`. Resolved at `setMapStyle()` call time, never inlined into source.

### Settings store (`js/settings.js`, new module)

Mirrors the pub/sub shape of `js/pins.js` and `js/groups.js`:

```
getKey(provider) → string
setKey(provider, value) → void
subscribe(fn) → unsubscribe
```

Hydrated from localStorage at boot, **before the picker renders** and **before any token-required style is selectable**. Preserves the hydration-before-subscribe invariant `app.js` already enforces.

### localStorage keys (added to `js/storage.js`)

- `city-pin-map.stadia-key.v1`
- `city-pin-map.maptiler-key.v1`
- `city-pin-map.thunderforest-key.v1`

Empty string = "not set". No client-side key validation.

### Curated additions (~22 new, ~29 total)

| Provider | Count | Styles |
|---|---|---|
| Stadia | 6 | Stamen Watercolor, Stamen Toner, Stamen Toner Lite, Stamen Terrain, Alidade Smooth, Alidade Smooth Dark |
| MapTiler | 10 | Streets, Outdoor, Winter, Backdrop, Pastel, Bright, Dataviz, Topo, Satellite Hybrid, Voyager |
| Thunderforest | 6 | OpenCycleMap, Transport, Landscape, Atlas, Outdoors, Pioneer |

> **Implementation note**: exact style URL templates and per-style IDs must be confirmed against current provider documentation at implementation time. Provider docs sometimes rename or version their styles; the plan should re-verify each URL before pinning it into MAP_STYLES.

## §2 — UI surfaces

### A. Picker (replaces header `<select>`)

Popover, not modal. Anchored below trigger.

| Aspect | Behavior |
|---|---|
| Trigger | Button in current `<select>` slot: `"Map: <current style> ▾"`. Same width — no header reflow. |
| Open | Click → popover (~360px wide, ≤ 480px tall, scrolls). |
| Content | Search input → grouped list (provider headers) → locked rows greyed with lock icon. |
| Row | Style name + 10px provider color dot. No thumbnails in v1. |
| Locked rows | Click → settings modal opens scrolled to that provider's section. |
| Footer | `⚙ Manage API keys` link → settings modal. |
| Keyboard | Arrows traverse, Enter selects, Escape closes, Tab focuses search. Click-outside dismisses. |
| Search | Debounced 100ms; matches style name + provider. |

### B. Settings modal

| Aspect | Behavior |
|---|---|
| Trigger (primary) | `⚙` button in side-panel header, beside Export/Import JSON. |
| Trigger (secondary) | Picker footer link + click on any locked picker row. |
| Layout | Three labeled sections — one per provider. |
| Per section | Provider name + 1-line description; signup link; `<input type="password">` with 👁 show/hide toggle; status pill `Not set` (grey) / `Set` (green). |
| Save | Persists on input blur, debounced 200ms. No explicit Save button. |
| No Test button | Invalid keys surface on first style load via existing `showError()`. |
| Close | Escape, click outside, or × button. |

## §3 — Runtime behavior

### Token URL resolution

```
lookup MAP_STYLES entry by id
  ↳ if requiresToken set:
       key = settings.getKey(style.requiresToken)
       if !key  → throw "<Provider> API key not set" → showError + abort
       else     → style.style.replaceAll('{api_key}', key)
  ↳ pass resolved URL or inline raster object to setStyleSafely()
```

`{api_key}` is **never** substituted at registry-definition time — only at the moment of `map.setStyle()` call.

### Style load wrapper — `setStyleSafely(styleId)`

| Step | Action |
|---|---|
| 1 | Record `previousStyleId` (the currently rendered style, not user's last click). |
| 2 | Resolve URL. On pre-flight error → `showError` + abort, leaving previous style in place. |
| 3 | Attach one-shot `styledata` (success) and `error` (failure) listeners + 5s timeout fallback. |
| 4 | Call `map.setStyle(...)`. |
| 5a | **Success** (styledata fires first) — persist new style id → picker highlights new style → clear listeners. |
| 5b | **Failure** (error fires first, or timeout) — call `map.setStyle()` again with previous style → `showError` → picker reverts. Persisted id unchanged. |

Race semantics: first event wins. Both listeners detach after the first fires (success or failure).

### Failure modes (all routed through `showError`)

| Mode | Detection | Banner |
|---|---|---|
| No key set | Pre-flight check in resolver | `"<Provider> API key not set. Open Settings to add one."` |
| Invalid key (401/403) | `error` event status | `"<Provider> rejected the API key. Verify it in Settings."` |
| Quota exceeded (429) | `error` event status | `"<Provider> free-tier quota exceeded. Try again later."` |
| Network/CORS/timeout | `error` event or 5s timeout | `"Failed to load style. Check your connection."` |

### Style swap preservation — *no change*

The existing `styledata` re-add logic in `js/map.js` (re-injects `pins` source/layer + `route` source/layer after every `setStyle()`) works unmodified for the new providers. New raster styles (e.g., MapTiler Satellite Hybrid) ride the same path as the current Wikimedia/OpenTopoMap/Esri raster entries.

### Boot-time hydration order (`js/app.js`)

```
1. hydrate settings store (loads 3 API keys from localStorage)
2. hydrate pins + groups stores
3. read persisted style id; if it requires a token whose key is missing
   → showError + fall back to DEFAULT_MAP_STYLE_ID
4. initMap() with the chosen style
5. subscribe UI renderers + render once explicitly to backfill hydration notify()
```

Only step 3 is new; the remainder is the existing ordering CLAUDE.md flags as load-bearing.

## Files

### Modified

| File | Change |
|---|---|
| `index.html` | Replace `<select id="map-style-select">` with `<button id="map-style-trigger">` + sibling popover root. Add settings modal root. Add ⚙ button in side-panel header. |
| `css/styles.css` | Picker popover styles (anchored positioning, search input, grouped list, locked-row treatment, footer). Settings modal styles. Status pill styles. |
| `js/map.js` | Backfill `provider` on existing 7 entries; add ~22 new entries. Rewrite `setMapStyle` → `setStyleSafely` per §3. Add `resolveStyleUrl(style, settings)` helper. |
| `js/storage.js` | Three new key constants. |
| `js/app.js` | Hydration order updated per §3. Wire new picker + settings panel modules. Boot-time guard for missing-key persisted style. |
| `CLAUDE.md` | Hard rule #3 update (text below). Append the new task to "What's shipped". |

### Created

| File | Purpose | Approx |
|---|---|---|
| `js/settings.js` | Settings store (pub/sub, mirrors `groups.js`). | ~60 lines |
| `js/settings-panel.js` | Modal renderer. Click ⚙ → open. Input blur → debounced save → status pill flip. | ~140 lines |
| `js/style-picker.js` | Popover renderer. Search filter, grouped list, locked-row UX, keyboard nav, click-outside dismiss. | ~180 lines |

### Not touched (scope guard)

`js/pins.js`, `js/pin-list.js`, `js/groups.js`, `js/group-panel.js`, `js/geocode.js`, `js/search.js`, `js/export.js`, `js/backup.js`. Implementer should resist incidental refactoring in these files.

## CLAUDE.md hard-rule #3 — exact replacement

**Current:**
> 3. **No paid APIs.** Use Leaflet + OpenStreetMap + Nominatim. None require an API key.

**New:**
> 3. **No paid APIs.** Use MapLibre GL JS + OpenStreetMap + Nominatim. Free-tier API keys (Stadia, MapTiler, Thunderforest) are allowed; no paid plans, ever. Keys live in `localStorage` per-user — never inlined in source, never committed to git, never included in JSON backup exports.

The edit also corrects the stale "Leaflet" reference (post-HARDEN-012).

## Acceptance test plan (manual)

No test runner — verification is manual browser interaction per the project's existing task workflow.

### Setup
- [ ] Open `index.html` — no console errors. ⚙ button visible in side panel. Style picker still in header.
- [ ] Click style picker → popover lists 29 styles grouped by provider. Locked styles greyed with lock icon.

### Settings flow
- [ ] Click ⚙ → modal opens, 3 sections, all "Not set".
- [ ] Paste valid Stadia key → blur → pill turns green. Reload → still green.
- [ ] Clear field → blur → pill turns grey.
- [ ] Signup link opens provider page in new tab.

### Picker flow
- [ ] Type "watercolor" in search → only Stamen Watercolor visible.
- [ ] Arrow keys navigate; Enter selects; Escape closes; click-outside closes.
- [ ] Click locked row → settings modal opens scrolled to that provider's section.
- [ ] Footer "⚙ Manage API keys" link → settings modal opens.

### Map style swap
- [ ] Switch to Stamen Watercolor → renders. Pins + route polyline preserved across swap.
- [ ] Reload → app boots into the persisted style.
- [ ] Switch to a MapTiler style → renders.
- [ ] Switch to a Thunderforest style → renders.

### Failure modes
- [ ] Wrong Stadia key + pick Stadia style → banner "Stadia rejected the API key…" + revert.
- [ ] Clear Stadia key while Stadia style is active + reload → banner + falls back to default.
- [ ] Disconnect network + pick token-required style → banner after ~5s timeout.

### PNG export (regression)
- [ ] Export with Stamen Watercolor backdrop → image correct.
- [ ] Export with MapTiler Satellite Hybrid → correct.
- [ ] Export with default OSM Standard → unchanged.

### Backup/restore (security)
- [ ] Export JSON → file does NOT contain any API keys.
- [ ] Import JSON on fresh browser → pins/groups restored; API keys remain unset.

## Out of scope (deliberate deferrals)

- Style thumbnails in the picker (text-only v1)
- Per-style enable/disable user toggles
- Option C (custom style URL paste) — settings infrastructure makes it cheap to add later
- Key rotation/expiry detection
- Encrypted key storage (localStorage trust level matches the rest of the app)
- Server-side proxy for keys (would violate "no backend" hard rule)
