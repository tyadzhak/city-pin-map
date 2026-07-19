// MapLibre GL JS setup, basemap registry, marker + route rendering.
//
// MapLibre is loaded as a classic <script defer> in index.html and exposes
// the global `maplibregl`. This module wraps initialization so the rest of
// the app never touches `maplibregl` directly — they go through getMap().

import { updatePin } from "./pins.js";
import { listGroups } from "./groups.js";
import { saveMapStyle, showError, loadHideLabels } from "./storage.js";
import * as settings from "./settings.js";
import {
  getMergedIcons,
  getIcon,
  subscribe as subscribeIcons,
  effectiveIcon as effectiveIconFromRegistry,
  DEFAULT_ICON_ID,
} from "./icons.js";

// Registry of available basemap styles. Hybrid: 4 vector styles served by
// OpenFreeMap (keyless), and 3 raster-only entries wrapped as inline
// MapLibre styles so we don't lose Wikimedia / OpenTopoMap / Esri Satellite
// (HARDEN-007 user-visible coverage). Single source of truth: js/app.js
// reads this to populate the header <select>, so adding a style here is the
// only change needed to expose it in the UI. All styles must be free and
// key-free per CLAUDE.md → "Hard rules".
//
// `style` is either:
//   - a string URL pointing at a hosted MapLibre style JSON (vector path), or
//   - an inline style object `{ version, sources, layers }` (raster path).
// `setMapStyle` passes the value to `map.setStyle()` either way — MapLibre
// accepts both.
export const MAP_STYLES = [
  {
    id: "osm",
    label: "OSM Standard",
    provider: "openfreemap",
    style: "https://tiles.openfreemap.org/styles/liberty",
  },
  {
    id: "carto-light",
    label: "Light",
    provider: "openfreemap",
    style: "https://tiles.openfreemap.org/styles/positron",
  },
  {
    id: "carto-dark",
    label: "Dark",
    provider: "openfreemap",
    style: "https://tiles.openfreemap.org/styles/dark",
  },
  {
    id: "carto-voyager",
    label: "Voyager",
    provider: "openfreemap",
    style: "https://tiles.openfreemap.org/styles/bright",
  },
  {
    id: "wikimedia",
    label: "Wikimedia",
    provider: "wikimedia",
    style: rasterStyle({
      tiles: ["https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png"],
      maxzoom: 19,
      attribution:
        '<a href="https://wikimediafoundation.org/wiki/Maps_Terms_of_Use">Wikimedia maps</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  },
  {
    id: "topo",
    label: "Topographic",
    provider: "opentopomap",
    style: rasterStyle({
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      maxzoom: 17,
      attribution:
        'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
  },
  {
    id: "esri-imagery",
    label: "Satellite",
    provider: "esri",
    style: rasterStyle({
      // Esri's ArcGIS REST tile endpoint uses {z}/{y}/{x} ordering (y before
      // x), the inverse of the OSM/Carto convention used elsewhere here.
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      maxzoom: 19,
      attribution:
        'Tiles © <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }),
  },

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
];

export const DEFAULT_MAP_STYLE_ID = "osm";

// Providers whose styles bake labels into the tile pixels server-side, so
// labels can't be hidden client-side. Single source of truth for PO-001's
// "Hide map labels" toggle: js/style-picker.js imports this to mark each
// matching row as disabled when the toggle is ON, and applyLabelVisibility
// below uses it to short-circuit on raster styles.
//
// Stadia is intentionally absent — it splits raster (Stamen family) and
// vector (Alidade Smooth) under one provider id, so a flat provider-set
// would over-match. Use isRasterStyleEntry() for per-entry checks; it
// reads this set AND handles the Stadia split.
export const RASTER_PROVIDERS = new Set([
  "wikimedia",
  "opentopomap",
  "esri",
  "thunderforest",
]);

// Per-entry raster check used by the picker (which rows to disable) and by
// applyLabelVisibility (which styles to skip). Combines the all-raster
// providers with the Stamen-only subset of Stadia (id prefix
// "stadia-stamen-"). Stadia Alidade Smooth/Dark are vector and flow
// through the label-walking path.
export function isRasterStyleEntry(entry) {
  if (!entry) return false;
  if (RASTER_PROVIDERS.has(entry.provider)) return true;
  if (entry.provider === "stadia" && entry.id.startsWith("stadia-stamen-")) {
    return true;
  }
  return false;
}

// Layer / source ids — kept in one place so the styledata re-add logic and
// the render functions agree on naming. Prefix avoids collisions with any
// layer id baked into the OpenFreeMap styles.
//
// PINS_LAYER_ID is the canonical pins layer. It paints every pin as a
// tintable SDF symbol driven by `pin.icon`, with a built-in white halo
// standing in for the previous shadow companion. Pins are never draggable
// — only PINS_LABELS_LAYER_ID (below) accepts drag interaction.
const PINS_SOURCE_ID = "city-pin-map.pins";
const PINS_LAYER_ID = "city-pin-map.pins-fill";
const PINS_COLOR_RING_LAYER_ID = "city-pin-map.pins-color-ring";
const PINS_LABELS_LAYER_ID = "city-pin-map.pins-labels";
const ROUTE_SOURCE_ID = "city-pin-map.route";
const ROUTE_LAYER_ID = "city-pin-map.route-line";

// Live default for the pins-labels symbol layer's text-size, in screen
// pixels at the live map zoom. Hoisted so setPinLabelSize(null) and the
// layer's initial `text-size` stay in sync — and so js/export.js can
// scale this value by the canvas-size coefficient at export time (PO-006).
// Kept as the storage-layer DEFAULT_PIN_STYLE.labelSize baseline — see
// currentPinStyle below, which is what actually drives the live layers once
// setPinStyle() has run.
export const BASE_PIN_LABEL_SIZE = 13;

// Baseline vertical text-offset (ems) that anchors a label just below its
// pin — the original static value from before labels were draggable.
// Per-pin drag offsets (pin.labelDy) are added on top of this, not in
// place of it, so an un-dragged label keeps rendering exactly where it
// always has.
const PIN_LABEL_BASE_OFFSET_Y_EMS = 1.0;

// Baseline pin icon size in CSS px at icon-size 1.0 (128px source SVG /
// pixelRatio 4). setPinStyle()'s `size` field is an ABSOLUTE px target, so
// every icon-size write is `pinStyle.size / BASE_PIN_ICON_SIZE`.
const BASE_PIN_ICON_SIZE = 32;

// Un-scaled geometry for the non-tintable-icon color ring (see
// PINS_COLOR_RING_LAYER_ID below) at BASE_PIN_ICON_SIZE. setPinStyle scales
// all three by the same size ratio so the ring stays proportionate to the
// icon it sits under.
const PINS_COLOR_RING_BASE_RADIUS = 6;
const PINS_COLOR_RING_BASE_TRANSLATE_Y = -2;
const PINS_COLOR_RING_BASE_STROKE_WIDTH = 1.5;

// Global pin style (Design tab "Pin style" group; storage.js's
// city-pin-map.pin-style.v1). Module-scoped so:
//   1. Layer creation (addPinAndRouteLayers) can read it directly instead of
//      hardcoding the pre-this-feature constants, which makes a basemap
//      swap's styledata re-add naturally pick up whatever was last set —
//      no separate "re-apply after swap" bookkeeping needed.
//   2. setPinLabelSize(null)'s restore-to-default path (used by export.js
//      around the label-size-bump-for-capture window) restores to the
//      user's CONFIGURED size, not a hardcoded baseline.
// Defaults mirror storage.js's DEFAULT_PIN_STYLE exactly so a page that
// never calls setPinStyle() (e.g. a stray direct initMap() call bypassing
// app.js) still renders at today's pre-this-feature visual baseline.
let currentPinStyle = {
  size: BASE_PIN_ICON_SIZE,
  labelSize: BASE_PIN_LABEL_SIZE,
  labelColor: "#1f2937",
  labelBold: false,
  labelFont: "",
};

// Pin icon registry. Single source of truth for both the map layer (image
// id used by `icon-image`) and the side-panel picker (label + same id).
// Adding an icon here is the only change needed to expose a new shape:
// place a single-color filled SVG at `src`, list it here, and the
// data-driven `icon-image` expression on the pins layer picks it up.
//
// All entries must be SDF-friendly (filled silhouettes, no per-pixel
// color), so MapLibre can tint them with the pin's effectiveColor().
// Files are MIT-licensed Phosphor icons (fill weight) plus this app's
// header attribution — see assets/icons/<id>.svg.
//
// Each icon's `id` is the public, stored-in-localStorage value used by
// the picker UI and persisted on every pin. The `imageId` is the
// MapLibre image-registry key — namespaced under "city-pin-map.icon."
// to avoid colliding with basemap sprites: OpenFreeMap's Liberty style
// already registers small POI sprites named "circle", "star", "heart",
// "flag", "house", "map-pin", and our addImage would either silently
// skip (when hasImage returned true on the basemap version) or fight
// the basemap's version through a stylechange race. The mapping
// happens once at the layer's icon-image expression via `concat`.
const PIN_ICON_IMAGE_PREFIX = "city-pin-map.icon.";

// PI-001's inline icon registry has been extracted to ./icons.js (PIL-001)
// so user-uploaded custom icons can join the same registry. This module
// re-exports the public surface for backwards compatibility with callers
// that still imported from map.js.
export const DEFAULT_PIN_ICON = DEFAULT_ICON_ID;

// PIN_ICONS is exposed as a Proxy so any reader doing
// `for (const icon of PIN_ICONS)` or `PIN_ICONS.map(...)` sees the live
// merged (built-in + user) registry. Used internally below in the image
// registration loop and re-exported for callers in pin-list.js / future
// icon-picker.js (which can also subscribe via icons.js for live updates).
export const PIN_ICONS = new Proxy([], {
  get(target, prop) {
    const live = getMergedIcons();
    return Reflect.get(live, prop, live);
  },
});

// Module-scoped singleton. Treat as private; outside callers use getMap().
let mapInstance = null;

// Cached pin snapshot used to repaint markers after a basemap swap.
// renderPins keeps this updated on every call; the styledata handler reads
// it to re-add the source/layer with the same data after setStyle() blew
// the previous style away.
let lastPinsSnapshot = [];
let lastRouteVisible = false;

// Drag state for an in-progress LABEL drag (pins themselves are never
// draggable). Set when a mousedown on a pin's label starts a drag; cleared
// on mouseup. The handlers live on `document` (not the map container) so a
// drag that passes through the side panel or briefly leaves the window
// doesn't desync.
let dragState = null;

// Handle for silently cancelling a still-pending FBL-010 boot guard (see
// initMap). Set inside initMap to a function that settles the guard without
// a banner; nulled once the guard settles on its own (confirm/fail) so a
// stale reference can't be re-invoked. setMapStyle calls this at the top of
// every swap — see the comment there for why.
let cancelBootGuard = null;

/**
 * Initialize the MapLibre map inside the given container element id.
 * Idempotent: calling twice returns the existing instance.
 *
 * `preserveDrawingBuffer: true` is required for the export pipeline —
 * without it, getCanvas().toDataURL() returns blank/black pixels. Costs
 * ~5–15% FPS on sustained pan per MapLibre's own benchmarks; invisible at
 * this app's scale.
 */
export function initMap(containerId, initialStyleId = DEFAULT_MAP_STYLE_ID) {
  if (mapInstance) return mapInstance;

  let initial =
    MAP_STYLES.find((s) => s.id === initialStyleId) ??
    MAP_STYLES.find((s) => s.id === DEFAULT_MAP_STYLE_ID);

  // Substitute any `{api_key}` placeholder before the first paint. The raw
  // MAP_STYLES entry carries the literal token (e.g. "…?key={api_key}"), and
  // the constructor fetches the style immediately — unlike the runtime swap
  // path, which always resolves via setMapStyle → resolveStyleUrl. Without
  // this, booting into a persisted token-required style would fetch the
  // literal placeholder → 403 → blank map.
  //
  // resolveStyleUrl throws when a token-required style has no key set. app.js's
  // boot gate normally diverts that case to the keyless default, but initMap
  // must not crash if reached directly, so degrade to the default here with a
  // banner (the default is keyless, so its resolve never throws) — mirroring
  // setMapStyle's missing-key handling.
  let resolvedStyle;
  try {
    resolvedStyle = resolveStyleUrl(initial);
  } catch (err) {
    showError(`${err.message}. Open Settings (⚙ in side panel) to add one.`);
    initial = MAP_STYLES.find((s) => s.id === DEFAULT_MAP_STYLE_ID);
    resolvedStyle = resolveStyleUrl(initial);
  }

  // MapLibre uses [lon, lat]; our previous Leaflet code used [lat, lon].
  // Center [0, 20] → 20° north, 0° east, matching the previous setView.
  mapInstance = new maplibregl.Map({
    container: containerId,
    style: resolvedStyle,
    center: [0, 20],
    zoom: 2,
    preserveDrawingBuffer: true,
  });

  // Boot-load guard. The very first style load gets the same failure
  // surfacing setMapStyle gives runtime swaps — but simpler: on failure we
  // only banner and leave the map as-is (the user recovers via the style
  // picker), never auto-swap to another style. currentRenderedStyleId is
  // set ONLY once a render is confirmed below — never unconditionally at
  // boot — so applyLabelVisibility's raster-check and a later failed swap's
  // revert both key off a style that actually rendered, not a boot guess.
  //
  // Mirrors setMapStyle's raster/vector split:
  //   VECTOR — a `styledata` firing proves the hosted style JSON loaded, so
  //     it confirms the render immediately (a bad URL/key fails the fetch
  //     before styledata fires, taking the error path).
  //   RASTER — `styledata` only proves the inline object parsed; a bad tile
  //     host fails later, so confirmation waits for an actual basemap tile
  //     `data` event (scoped to the raster source id, since the app's own
  //     pins/route sources also fire tile `data`), or the timeout / a tile
  //     `error`.
  const bootIsRaster = isRasterStyleEntry(initial);
  let bootSettled = false;

  // First-evidence-wins: whichever of confirm/fail/timeout fires first
  // commits and the rest no-op, exactly like setMapStyle's `settled` guard.
  const confirmBoot = () => {
    if (bootSettled) return;
    bootSettled = true;
    bootCleanup();
    cancelBootGuard = null;
    currentRenderedStyleId = initial.id;
  };

  const failBoot = (status) => {
    if (bootSettled) return;
    bootSettled = true;
    bootCleanup();
    cancelBootGuard = null;
    // Reuse setMapStyle's message builder (key/quota specifics), then name
    // the style and point the user at recovery. No revert, no auto-swap.
    showError(
      `${buildStyleErrorMessage(initial, status)} The "${initial.label}" ` +
        `basemap didn't render at startup — pick another from the style picker.`
    );
  };

  // Vector: styledata confirms; any error is a real load failure (vector
  // styles have a `glyphs` property, so the pins-labels layer never trips a
  // benign style-validation error the way the raster inline object does).
  const onBootStyleData = () => confirmBoot();
  const onBootError = (err) => failBoot(err && err.error && err.error.status);

  // Raster: confirm only when a basemap tile actually loads; fail only on an
  // error attributable to the raster source (ignoring the benign no-sourceId
  // glyphs validation error our pins-labels layer emits over inline styles).
  const onBootTileData = (e) => {
    if (
      e.dataType === "source" &&
      e.sourceId === "raster-source" &&
      e.tile &&
      e.tile.state === "loaded"
    ) {
      confirmBoot();
    }
  };
  const onBootTileError = (err) => {
    if (!err || err.sourceId !== "raster-source") return;
    failBoot(err.error && err.error.status);
  };

  const bootCleanup = () => {
    mapInstance.off("styledata", onBootStyleData);
    mapInstance.off("data", onBootTileData);
    mapInstance.off("error", onBootError);
    mapInstance.off("error", onBootTileError);
    clearTimeout(bootTimer);
  };

  // Silent settle: a user-initiated style swap takes over before the boot
  // guard resolves on its own. The guard is gated on the BOOT style's
  // identity (a raster boot only confirms on ITS OWN raster-source tile
  // events; a vector boot only confirms on styledata for that load), so once
  // setMapStyle swaps to a different style those events can never fire
  // again — the guard would otherwise sit until its 5s timeout and banner a
  // false "didn't render at startup" failure naming the OLD style while the
  // new one is rendering fine. No banner, no confirm: the boot guard's job
  // outlives its usefulness the moment a user-initiated swap takes over, so
  // we just detach it. setMapStyle calls this before starting its own swap.
  cancelBootGuard = () => {
    if (bootSettled) return;
    bootSettled = true;
    bootCleanup();
    cancelBootGuard = null;
  };

  // Covers both a vector style whose JSON never resolves and a raster style
  // whose tiles never load — either way the failure surfaces instead of a
  // permanently blank, silent map. Registered before the `load`/styledata
  // handlers below so onBootStyleData sets currentRenderedStyleId ahead of
  // the applyLabelVisibility styledata handler on the first firing.
  const bootTimer = setTimeout(() => failBoot(0), STYLE_LOAD_TIMEOUT_MS);
  if (bootIsRaster) {
    mapInstance.on("data", onBootTileData);
    mapInstance.on("error", onBootTileError);
  } else {
    mapInstance.once("styledata", onBootStyleData);
    mapInstance.on("error", onBootError);
  }

  // The first style emits `load` once tiles + sprites + glyphs are ready.
  // Re-add markers/route here so a hydrated pin set paints on first frame
  // even though renderPins was called before the style was ready.
  // Awaiting the layer setup ensures the pins source exists before the
  // first renderPins() call writes its data.
  mapInstance.on("load", async () => {
    await addPinAndRouteLayers();
    renderPins(lastPinsSnapshot);
    renderRoute(lastPinsSnapshot, { visible: lastRouteVisible });
  });
  attachPinInteractions();

  // Re-apply the hide-labels preference on every basemap swap. setStyle()
  // blows away the layer set, so a one-shot mutation at toggle time would
  // silently revert on the next swap. Re-reading from storage (rather than
  // closing over a captured value) keeps map.js free of the toggle's UI
  // state — the storage module is already the shared source of truth.
  mapInstance.on("styledata", () => {
    applyLabelVisibility(loadHideLabels());
  });

  // Icon-registry subscription. When the user adds a custom icon, register
  // its MapLibre image and rebuild the source so any pin already using its
  // id renders correctly. Removing an icon doesn't need an explicit
  // mapInstance.removeImage call — the icon is gone from the registry, and
  // its image just goes unreferenced. The next styledata cycle drops it
  // (setStyle wipes the registry; the missing icon won't be re-added).
  subscribeIcons(async (mergedIcons) => {
    if (!mapInstance) return;
    // Per-icon fault tolerance (mirrors addPinAndRouteLayers): one failed
    // sprite is skipped, not fatal, so adding a valid icon still registers
    // even while a corrupt one sits in the registry.
    const failedIds = await loadPinIconImages(mergedIcons);
    if (!mapInstance) return;
    reportFailedIcons(failedIds);
    for (const icon of mergedIcons) {
      if (!pinIconImages.has(icon.id)) continue; // failed to load; skip
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

  return mapInstance;
}

/**
 * Hide or show built-in basemap labels on the active style.
 *
 * Vector basemaps render labels as dedicated `symbol`-type layers with a
 * `layout.text-field` property. We toggle their visibility via
 * setLayoutProperty so the change is fully reversible without burning a
 * style swap on a UI preference.
 *
 * Raster basemaps bake labels into the tile pixels server-side, so this is
 * a no-op for them — the inline notice next to the toggle (managed by
 * app.js) is the user-facing signal that the preference doesn't apply.
 *
 * Idempotent and safe to call before any layers exist (e.g. during the
 * gap between a setStyle() request and the matching styledata event).
 */
export function applyLabelVisibility(hide) {
  if (!mapInstance) return;

  // Short-circuit for raster styles. The active entry's provider tells us
  // this directly, no layer inspection needed. We still bail out cleanly
  // even if the style is in a transient state where getStyle() returns
  // a placeholder — the next styledata firing will retry.
  const activeEntry = MAP_STYLES.find((s) => s.id === currentRenderedStyleId);
  if (activeEntry && isRasterStyleEntry(activeEntry)) return;

  const style = mapInstance.getStyle();
  if (!style || !Array.isArray(style.layers)) return;

  for (const layer of style.layers) {
    if (!isBasemapLabelLayer(layer)) continue;
    mapInstance.setLayoutProperty(
      layer.id,
      "visibility",
      hide ? "none" : "visible"
    );
  }
}

/**
 * Override or restore the pins-labels layer's `text-size`. Used by the
 * PNG export (PO-006) to bump label size in proportion to the export
 * canvas, then restore the live default after capture. Passing `null`
 * (or omitting the argument) restores the user's CONFIGURED label size
 * (currentPinStyle.labelSize — set via setPinStyle(), defaulting to
 * BASE_PIN_LABEL_SIZE until a caller sets a custom one) rather than a
 * hardcoded baseline, so the export's "restore" step never reverts a
 * custom pin-style choice back to the pre-Pin-style-feature default.
 *
 * Idempotent: silently no-ops when the map or the labels layer don't
 * exist yet (e.g. during the gap between a setStyle() request and the
 * matching styledata event).
 */
export function setPinLabelSize(sizeOrNull) {
  if (!mapInstance) return;
  if (!mapInstance.getLayer(PINS_LABELS_LAYER_ID)) return;
  const size = sizeOrNull == null ? currentPinStyle.labelSize : sizeOrNull;
  mapInstance.setLayoutProperty(PINS_LABELS_LAYER_ID, "text-size", size);
}

/**
 * Read the currently CONFIGURED pin-label size (not any transient override
 * setPinLabelSize() may have applied for an in-flight export). js/export.js
 * uses this as the base it multiplies by the export coefficient, so a
 * custom labelSize scales correctly into every export preset instead of the
 * pipeline assuming BASE_PIN_LABEL_SIZE.
 */
export function getPinLabelSize() {
  return currentPinStyle.labelSize;
}

/**
 * Apply the global pin style (Design tab "Pin style" group) to the live
 * marker/label layers. Called once at boot with storage.js's
 * loadPinStyle(), and again on every Design-tab edit.
 *
 * Deliberately does NOT touch pinStyle.labelFont beyond storing it —
 * MapLibre's `text-font` can only reference glyphs the active basemap's
 * `glyphs` endpoint actually serves (see the PINS_LABELS_LAYER_ID comment
 * in addPinAndRouteLayers), and OpenFreeMap + the raster wrapper styles
 * only guarantee the Noto Sans Regular/Bold pair used for text-font below.
 * An arbitrary family would 404 the glyph fetch and silently blank BOTH the
 * labels layer and the pin-icon symbol layer sharing that source (a prior
 * incident this codebase already hit once — see the text-font comment on
 * PINS_LABELS_LAYER_ID). So labelFont is persisted for forward-compat but
 * has no UI control yet and is not applied to text-font; see the "Font
 * family" note in this task's report/commit for the full rationale.
 *
 * Merges over the previous value (partial updates from a single control's
 * change event don't clobber the other fields) and is safe to call before
 * the map/layers exist — it just updates the module-scoped baseline that
 * addPinAndRouteLayers reads when it (re)creates the layers.
 */
export function setPinStyle(pinStyle) {
  if (!pinStyle) return;
  currentPinStyle = {
    size: Number.isFinite(pinStyle.size) ? pinStyle.size : currentPinStyle.size,
    labelSize: Number.isFinite(pinStyle.labelSize)
      ? pinStyle.labelSize
      : currentPinStyle.labelSize,
    labelColor:
      typeof pinStyle.labelColor === "string"
        ? pinStyle.labelColor
        : currentPinStyle.labelColor,
    labelBold: Boolean(pinStyle.labelBold),
    labelFont:
      typeof pinStyle.labelFont === "string"
        ? pinStyle.labelFont
        : currentPinStyle.labelFont,
  };
  applyPinStyleToLayers();
}

// Pushes currentPinStyle onto whatever pin/label/ring layers currently
// exist. No-ops per-layer (not per-call) so a mid-styledata call where only
// some layers have been re-added yet doesn't throw — addPinAndRouteLayers
// also calls this once at the end of layer setup as a defensive re-apply,
// which is a harmless no-op when the layers were just created FROM
// currentPinStyle in the first place.
function applyPinStyleToLayers() {
  if (!mapInstance) return;
  const iconScale = currentPinStyle.size / BASE_PIN_ICON_SIZE;

  if (mapInstance.getLayer(PINS_LAYER_ID)) {
    mapInstance.setLayoutProperty(PINS_LAYER_ID, "icon-size", iconScale);
  }
  if (mapInstance.getLayer(PINS_COLOR_RING_LAYER_ID)) {
    mapInstance.setPaintProperty(
      PINS_COLOR_RING_LAYER_ID,
      "circle-radius",
      PINS_COLOR_RING_BASE_RADIUS * iconScale
    );
    mapInstance.setPaintProperty(PINS_COLOR_RING_LAYER_ID, "circle-translate", [
      0,
      PINS_COLOR_RING_BASE_TRANSLATE_Y * iconScale,
    ]);
    mapInstance.setPaintProperty(
      PINS_COLOR_RING_LAYER_ID,
      "circle-stroke-width",
      PINS_COLOR_RING_BASE_STROKE_WIDTH * iconScale
    );
  }
  if (mapInstance.getLayer(PINS_LABELS_LAYER_ID)) {
    mapInstance.setLayoutProperty(
      PINS_LABELS_LAYER_ID,
      "text-size",
      currentPinStyle.labelSize
    );
    mapInstance.setLayoutProperty(PINS_LABELS_LAYER_ID, "text-font", [
      currentPinStyle.labelBold ? "Noto Sans Bold" : "Noto Sans Regular",
    ]);
    mapInstance.setPaintProperty(
      PINS_LABELS_LAYER_ID,
      "text-color",
      currentPinStyle.labelColor
    );
    // labelSize may just have changed. text-offset is authored in ems (×
    // text-size) but pin.labelDx/labelDy are stored in constant screen px,
    // so every feature's materialized `labelOffset` (computeLabelOffsetEms)
    // is only correct for the labelSize it was built against — rebuild the
    // source data so dragged labels keep their PIXEL offset instead of
    // drifting when the user changes the global label size.
    const source = mapInstance.getSource(PINS_SOURCE_ID);
    if (source) source.setData(pinsToFeatureCollection(lastPinsSnapshot));
  }
}

// True when the layer is a built-in basemap label layer that the toggle
// should affect. The rule is intentionally registry-agnostic: every vector
// provider (OpenFreeMap, MapTiler, Stadia Alidade) puts city / country /
// street / POI text in `type: "symbol"` layers with a `layout["text-field"]`
// property, so the inverse — checking layer ids per provider — would mean
// hard-coding a list per style and re-doing it every time a provider
// rev's their layer naming.
//
// Layers added by this app (pin labels added in PO-002, route line, pin
// circles) live under the "city-pin-map." id namespace and must never be
// hidden by this toggle — they're user-data layers, not basemap layers.
function isBasemapLabelLayer(layer) {
  if (!layer) return false;
  if (layer.id && layer.id.startsWith("city-pin-map.")) return false;
  if (layer.type !== "symbol") return false;
  return Boolean(layer.layout && layer.layout["text-field"]);
}

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

// Track the currently-rendered style id so a failed swap can revert.
// Different from the user's last *click*: this updates only on the
// `styledata` success path. Initialized lazily on the first successful
// swap; null until then means "whatever initMap painted".
let currentRenderedStyleId = null;

// Subscribers notified whenever a style swap actually RENDERS (the
// styledata success path in setMapStyle). Mirrors the pins.js pub/sub
// shape. The key subtlety: a failed swap reverts by RE-ENTERING
// setMapStyle(previousId, { persist: false }), which itself reaches
// onSuccess when the revert renders — so the revert flows through this
// same notification with the reverted (actually-rendered) style id. That
// lets the UI (js/app.js) correct its optimistic state after a failure
// without any extra failure-specific wiring. Fired on RENDER, never on
// request, so a subscriber must NOT call back into setMapStyle (that would
// loop).
const styleRenderedSubscribers = new Set();

/**
 * Subscribe to style-render events. The callback receives the style id
 * that just finished rendering on the map (success or post-revert).
 * Returns an unsubscribe function. Mirrors pins.js/settings.js.
 */
export function onStyleRendered(fn) {
  styleRenderedSubscribers.add(fn);
  return () => styleRenderedSubscribers.delete(fn);
}

function notifyStyleRendered(styleId) {
  for (const fn of styleRenderedSubscribers) fn(styleId);
}

// Tracks the in-flight style swap's cleanup so a later setMapStyle call
// can cancel a prior pending swap. Without this, stale onError listeners
// from a swap that's still loading can fire on a later swap's events
// (e.g. user clicks Style A then Style B mid-load — A's error handler
// would otherwise survive and could revert B with a spurious banner).
let activeSwapCleanup = null;

const STYLE_LOAD_TIMEOUT_MS = 5000;

/**
 * Swap the active basemap to the style identified by `styleId`, with
 * resilience: races success against error (failure) and a 5s timeout. On
 * failure, reverts to the previously-rendered style and surfaces a banner
 * via showError(). The persisted style id (saveMapStyle) only updates on
 * success — reload is guaranteed to boot into a known-working style.
 *
 * What counts as "success" differs by style type (FBL-006):
 *
 *   VECTOR (hosted style JSON — OpenFreeMap, Stadia, MapTiler): a rejected
 *   key or bad URL fails the style-JSON *fetch*, before `styledata` fires.
 *   So `styledata` firing already proves the style loaded — we settle on it
 *   immediately, no added latency.
 *
 *   RASTER (inline style object — Thunderforest, Wikimedia, OpenTopoMap,
 *   Esri): MapLibre parses the inline object locally and fires `styledata`
 *   almost instantly, BEFORE a single tile has been requested. A bad API
 *   key only fails later at tile-fetch time. So for raster we WITHHOLD the
 *   success verdict until a tile actually loads (a `data` event carrying a
 *   `tile`); a tile fetch failure fires `error` and takes the revert path.
 *   Without this, a garbage Thunderforest key would persist a blank map.
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

  // Cancel any in-flight prior swap before starting a new one. cleanup()
  // detaches its specific listeners by reference and clears its timer —
  // it does NOT show a banner or trigger a revert.
  if (activeSwapCleanup) {
    activeSwapCleanup();
    activeSwapCleanup = null;
  }

  // Same cancellation for a still-pending FBL-010 boot guard. Without this,
  // a raster boot style swapped away from before its first tile loads would
  // leave the guard's raster-gated listeners waiting on events that can
  // never fire, and it would banner a false startup-failure 5s later. See
  // the comment on cancelBootGuard's assignment in initMap.
  if (cancelBootGuard) cancelBootGuard();

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

  // Per-call raster/vector branch chosen from the entry being swapped TO.
  // A failed swap reverts by re-entering setMapStyle(previousId, …), and
  // previousId's own entry re-picks its branch — so a revert to a vector
  // style always takes the fast styledata path even if the failed swap was
  // raster (and vice-versa).
  const isRaster = isRasterStyleEntry(entry);

  // First-event-wins race. `settled` guards every settle path (styledata
  // for vector, tile-load for raster, error, and timeout) so only the FIRST
  // one commits and the rest no-op. cleanup() detaches all listeners +
  // clears the timer, exactly once.
  let settled = false;

  // Commit the success verdict: record the rendered style, (re)add the
  // pin/route layers, persist (unless reverting), and notify. For the
  // vector fast path this is the whole success handler; for raster the
  // layers were already added on `styledata` (so pins paint during the
  // tile wait), and addPinAndRouteLayers is idempotent, so re-calling it
  // here is a cheap no-op.
  const commitSuccess = async () => {
    settled = true;
    cleanup();
    currentRenderedStyleId = entry.id;
    await addPinAndRouteLayers();
    renderPins(lastPinsSnapshot);
    renderRoute(lastPinsSnapshot, { visible: lastRouteVisible });
    if (persist) saveMapStyle(entry.id);
    // Fire AFTER currentRenderedStyleId is updated so subscribers reading
    // it see the just-rendered style. The failed-swap revert re-enters
    // setMapStyle(previousId, { persist:false }) and reaches this same
    // path, so the UI naturally hears the reverted id — no failure-specific
    // notification needed. Subscribers only update UI state; they must not
    // re-invoke setMapStyle, or the revert would loop.
    notifyStyleRendered(entry.id);
  };

  // Shared failure verdict: banner + revert, never persist. Called by the
  // vector error listener, the raster tile-error listener, and the timeout.
  // `status` feeds buildStyleErrorMessage (0 = timeout/generic).
  const settleFailure = (status) => {
    if (settled) return;
    settled = true;
    cleanup();
    showError(buildStyleErrorMessage(entry, status));
    // Revert to the previously-rendered style. Pass persist:false so a
    // failed swap can never overwrite the persisted preference.
    if (previousId && previousId !== entry.id) {
      setMapStyle(previousId, { persist: false });
    }
  };

  // Vector success: `styledata` proves the hosted style JSON loaded.
  const onVectorStyleData = () => {
    if (settled) return;
    commitSuccess();
  };

  // Vector failure: any error during a vector swap is a real load failure
  // (vector styles HAVE a `glyphs` property, so adding pin layers never
  // trips the style-validation error the raster path must ignore). Unchanged
  // from the pre-FBL-006 behavior.
  const onVectorError = (err) => {
    const status = err && err.error && err.error.status;
    settleFailure(status);
  };

  // Raster: `styledata` only proves the inline object parsed — no tile has
  // been fetched yet. Add the pin/route layers now so pins paint, but do
  // NOT settle: wait for a real basemap tile (onRasterTileData) or the
  // timeout. Not `settled`-guarded because it's registered via once() and
  // only performs idempotent layer setup — it never commits the verdict.
  //
  // Adding the pins-labels symbol layer here fires a BENIGN style-validation
  // error ("text-field requires a style glyphs property") because the inline
  // rasterStyle() objects have no `glyphs`. That error has no `sourceId`, so
  // onRasterTileError below ignores it — only errors attributable to the
  // basemap raster source revert the swap.
  const onRasterStyleData = async () => {
    await addPinAndRouteLayers();
    if (!mapInstance) return;
    renderPins(lastPinsSnapshot);
    renderRoute(lastPinsSnapshot, { visible: lastRouteVisible });
  };

  // Raster tile-loaded probe. Success ONLY when a basemap tile actually
  // renders: `data` scoped to the raster source (`rasterStyle()` always keys
  // it "raster-source") with a loaded tile. The sourceId scope is load-
  // bearing — the app's OWN pins/route GeoJSON sources also fire tile `data`
  // events, and they load instantly, so an unscoped predicate would let a
  // genuinely-broken basemap settle as success.
  const onRasterTileData = (e) => {
    if (settled) return;
    if (
      e.dataType === "source" &&
      e.sourceId === "raster-source" &&
      e.tile &&
      e.tile.state === "loaded"
    ) {
      commitSuccess();
    }
  };

  // Raster failure: only a basemap tile fetch failure counts. Gate on the
  // raster source id so we ignore (a) the benign glyphs style-validation
  // error from our pins-labels layer and (b) any pins/route source noise —
  // neither should revert a swap whose tiles are loading fine.
  const onRasterTileError = (err) => {
    if (settled) return;
    if (!err || err.sourceId !== "raster-source") return;
    const status = err.error && err.error.status;
    settleFailure(status);
  };

  const cleanup = () => {
    // off() on a listener that was never attached (e.g. the raster handlers
    // on a vector swap) is a harmless no-op, so we detach all of them
    // unconditionally rather than branch on isRaster again here.
    mapInstance.off("styledata", onVectorStyleData);
    mapInstance.off("styledata", onRasterStyleData);
    mapInstance.off("data", onRasterTileData);
    mapInstance.off("error", onVectorError);
    mapInstance.off("error", onRasterTileError);
    // Safe even when cleanup() is called from inside a settle path because
    // the timer fired: clearTimeout() on an already-fired timer is a no-op.
    if (timer) clearTimeout(timer);
    // Clear the module pointer ONLY if it still references this cleanup;
    // a later setMapStyle may have replaced it (in which case we leave it).
    if (activeSwapCleanup === cleanup) {
      activeSwapCleanup = null;
    }
  };
  // Timeout applies to BOTH paths: a vector style whose JSON never resolves,
  // and a raster style whose tiles never load (e.g. a silent stall). Treated
  // as failure → revert, so a raster swap can never hang forever waiting for
  // a tile that isn't coming. Calls settleFailure directly (status 0) so it
  // works regardless of the sourceId gate on the raster error listener.
  const timer = setTimeout(
    () => settleFailure(0),
    STYLE_LOAD_TIMEOUT_MS
  );

  // `once` is wrong for error — many errors can fire during a single failing
  // load; we want the FIRST relevant one. Use on() and rely on `settled`.
  if (isRaster) {
    mapInstance.once("styledata", onRasterStyleData);
    mapInstance.on("data", onRasterTileData);
    mapInstance.on("error", onRasterTileError);
  } else {
    mapInstance.once("styledata", onVectorStyleData);
    mapInstance.on("error", onVectorError);
  }

  mapInstance.setStyle(resolved, { diff: false });
  activeSwapCleanup = cleanup;
}

/** Returns the live map instance, or null if initMap() hasn't run yet. */
export function getMap() {
  return mapInstance;
}

/**
 * Synchronize the rendered pins source against `pins`.
 *
 * Markers are GeoJSON features in a single `geojson` source, painted by
 * two stacked symbol layers: a non-SDF shadow+contour beneath, and an
 * SDF tintable fill on top. Group color override is materialized into
 * each feature's `properties.color` — the fill layer's `icon-color`
 * reads it via `['get', 'color']`.
 *
 * Safe to call on every pin-store change. No-op until the style is loaded
 * (the source doesn't exist yet) — the `load` and `styledata` handlers
 * call us back with the latest snapshot once the source is in place.
 */
export function renderPins(pins) {
  lastPinsSnapshot = pins.slice();
  if (!mapInstance) return;
  const source = mapInstance.getSource(PINS_SOURCE_ID);
  if (!source) return;
  source.setData(pinsToFeatureCollection(pins));
}

/**
 * Synchronize the connecting-route line source against `pins` and the
 * toggle. Same data flow as renderPins: a GeoJSON source + a line layer.
 *
 * Sorted by createdAt ascending so the line traces the user's pinning
 * order — the natural travel-narrative order (PROJECT.md).
 */
export function renderRoute(pins, { visible }) {
  lastRouteVisible = visible;
  if (!mapInstance) return;
  const source = mapInstance.getSource(ROUTE_SOURCE_ID);
  if (!source) return;

  if (!visible || pins.length < 2) {
    source.setData(emptyLineFeatureCollection());
    return;
  }

  const ordered = pins.slice().sort((a, b) => a.createdAt - b.createdAt);
  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: ordered.map((p) => [p.lon, p.lat]),
        },
        properties: {},
      },
    ],
  });
}

/**
 * Resolve the color a pin should render as. Group color wins when the pin
 * is assigned to a still-existing group; otherwise the pin's own color.
 * A pin whose `group` references a deleted group is silently treated as
 * ungrouped — render must never crash on stale data.
 */
export function effectiveColor(pin) {
  if (!pin.group) return pin.color;
  const group = listGroups().find((g) => g.id === pin.group);
  return group?.color ?? pin.color;
}

/**
 * Resolve the icon id a pin should render as. Re-export from ./icons.js
 * which now owns the merged (built-in + user) registry. Render must never
 * reference a missing image — MapLibre would log "Image 'foo' could not be
 * loaded" and drop the feature; the registry's clamp-to-known-id contract
 * defends against that.
 */
export function effectiveIcon(pin) {
  return effectiveIconFromRegistry(pin);
}

// ---- Internals --------------------------------------------------------

function rasterStyle({ tiles, maxzoom, attribution }) {
  return {
    version: 8,
    sources: {
      "raster-source": {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom,
        attribution,
      },
    },
    layers: [
      {
        id: "raster-layer",
        type: "raster",
        source: "raster-source",
      },
    ],
  };
}

function pinsToFeatureCollection(pins) {
  return {
    type: "FeatureCollection",
    features: pins.map((pin) => {
      let iconId = effectiveIcon(pin);
      // effectiveIcon's clamp only guards *unknown* ids. A known id whose
      // *image* failed to load (corrupt user SVG, missing built-in file)
      // isn't in the cache — referencing its unregistered MapLibre image
      // would make MapLibre drop the whole feature. Fall back to the default
      // icon so the pin still renders. (If even the default failed to load,
      // this leaves iconId at the default and only that single feature's
      // icon is dropped — the layers themselves are still created.)
      if (!pinIconImages.has(iconId)) iconId = DEFAULT_ICON_ID;
      const iconEntry = getIcon(iconId);
      // tintable defaults to true so a transient pre-registry-load state
      // still renders sensibly. The default-pin built-in is always
      // tintable, so this is the conservative fallback.
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
          labelOffset: computeLabelOffsetEms(pin),
        },
      };
    }),
  };
}

// Per-pin label offset in EMS for the labels layer's data-driven
// `text-offset` (draggable labels). pin.labelDx/labelDy are stored in constant
// SCREEN PIXELS (set by dragging the label on the map); text-offset only
// accepts ems (× text-size), so we divide by the CONFIGURED label size here
// — not any transient export-time override (setPinLabelSize) — so the
// on-screen offset stays pixel-constant across zoom (ems × a fixed
// text-size is a fixed px value at every zoom) and is recomputed whenever
// currentPinStyle.labelSize changes (see applyPinStyleToLayers, which
// re-sets the pins source data after a labelSize edit for exactly this
// reason).
function computeLabelOffsetEms(pin) {
  const labelSize = currentPinStyle.labelSize || BASE_PIN_LABEL_SIZE;
  const dxPx = Number.isFinite(pin.labelDx) ? pin.labelDx : 0;
  const dyPx = Number.isFinite(pin.labelDy) ? pin.labelDy : 0;
  return [dxPx / labelSize, PIN_LABEL_BASE_OFFSET_Y_EMS + dyPx / labelSize];
}

function emptyLineFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

// Cached pin-sprite Image objects, keyed by icon id. setStyle() wipes
// MapLibre's image registry on every basemap swap, but the underlying
// HTMLImageElement is reusable — load once, re-register on every styledata
// via addImage. User icons (with inline `svg` strings) load via data:
// URLs so there's no network round-trip; built-ins use their `src` path
// under assets/icons/ and the browser HTTP-caches them.
const pinIconImages = new Map();

// Remembers the last set of failed icon ids we surfaced a banner for. Each
// basemap swap re-runs the load path (and re-retries the still-failing
// icons), so without this guard the same failure would re-spam a banner on
// every styledata cycle. Keyed by the sorted failed-id list; reset to "" on
// full recovery so a genuinely new failure later still reports.
let lastReportedFailedKey = "";

// Load pin sprites into the `pinIconImages` cache, one Image per icon.
//
// Fault-tolerant per icon: a single undecodable sprite (corrupt user SVG,
// missing built-in file) must NOT reject the batch and blank out every pin.
// Uses Promise.allSettled so successful loads always land in the cache; the
// returned Set names the icon ids that FAILED so callers can skip their
// addImage and surface a banner. Already-cached icons short-circuit, so
// style swaps stay cheap and only ever retry the ids not yet loaded.
async function loadPinIconImages(targetIcons) {
  const failed = new Set();
  const missing = targetIcons.filter((icon) => !pinIconImages.has(icon.id));
  if (missing.length === 0) return failed;
  const results = await Promise.allSettled(
    missing.map((icon) => fetchImage(iconImageHref(icon)))
  );
  results.forEach((result, i) => {
    const icon = missing[i];
    if (result.status === "fulfilled") {
      pinIconImages.set(icon.id, result.value);
    } else {
      failed.add(icon.id);
    }
  });
  return failed;
}

// Surface at most one banner per distinct failed-icon set. Debounced across
// styledata cycles via lastReportedFailedKey. Names the icons by their
// registry label so the user can find and remove the offending upload.
function reportFailedIcons(failedIds) {
  const key = [...failedIds].sort().join("|");
  if (key === lastReportedFailedKey) return;
  lastReportedFailedKey = key;
  if (failedIds.size === 0) return; // recovered — reset only, no banner
  const names = [...failedIds].map((id) => getIcon(id)?.label ?? id).join(", ");
  const noun = failedIds.size === 1 ? "icon" : "icons";
  showError(
    `Could not load pin ${noun}: ${names}. Affected pins use the default icon.`
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

async function addPinAndRouteLayers() {
  if (!mapInstance) return;

  // Pin sprites must be in the registry before the symbol layer can
  // reference them by id. The loader caches per-icon, so subsequent
  // style swaps and registry-tick re-runs are cheap.
  const icons = getMergedIcons();
  // Per-icon fault tolerance: a failed sprite is skipped, never fatal. We
  // still create every source and layer below so one corrupt icon can't
  // blank out all pins, labels, and the route.
  const failedIds = await loadPinIconImages(icons);
  // Defensive against a teardown that snuck in during the await.
  if (!mapInstance) return;
  reportFailedIcons(failedIds);

  // Re-register every pin icon on every styledata cycle. setStyle() wipes
  // the image registry; the hasImage() check short-circuits the rare path
  // where MapLibre kept our image, avoiding the "image already exists"
  // console warning. The PIN_ICON_IMAGE_PREFIX namespacing keeps these
  // IDs out of collision range with basemap sprites that share short
  // names like "circle"/"star"/"heart" — without the prefix, the
  // hasImage guard would see the basemap version and skip our addImage,
  // and the layer's icon-image would point at the wrong sprite (small,
  // non-SDF, untintable).
  //
  // sdf:icon.tintable — tintable user icons get SDF (icon-color paint
  // tints them); non-tintable ones get raster RGBA (color-ring layer
  // shows group color underneath).
  for (const icon of icons) {
    // Skip icons whose image failed to load — their sprite isn't in the
    // cache, so addImage would register `undefined` and throw. Pins that
    // referenced them already fell back to the default icon in
    // pinsToFeatureCollection().
    if (!pinIconImages.has(icon.id)) continue;
    const imageId = PIN_ICON_IMAGE_PREFIX + icon.id;
    if (!mapInstance.hasImage(imageId)) {
      mapInstance.addImage(imageId, pinIconImages.get(icon.id), {
        sdf: icon.tintable,
        // pixelRatio:4 with 128×128 source SVGs → on-screen display at
        // 32 CSS px (matches PO-003's drop-pin footprint). The 4× source
        // headroom is what gives the SDF generator enough alpha samples
        // to interpolate smooth curves at retina and 1× displays alike.
        pixelRatio: 4,
      });
    }
  }

  // Route source + layer first, so it draws underneath the pins (MapLibre
  // z-orders by add-order within a layer type).
  if (!mapInstance.getSource(ROUTE_SOURCE_ID)) {
    mapInstance.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: emptyLineFeatureCollection(),
    });
  }
  if (!mapInstance.getLayer(ROUTE_LAYER_ID)) {
    mapInstance.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: {
        "line-color": "#1d3557",
        "line-width": 3,
        "line-opacity": 0.85,
      },
    });
  }

  if (!mapInstance.getSource(PINS_SOURCE_ID)) {
    mapInstance.addSource(PINS_SOURCE_ID, {
      type: "geojson",
      data: pinsToFeatureCollection(lastPinsSnapshot),
    });
  }

  // Color ring for non-tintable icons (full-color custom uploads). The
  // pins-fill layer's icon-color paint is silently ignored on non-SDF
  // sprites, so without a separate color cue, group color and per-pin
  // color would never read on those pins. The ring sits slightly above
  // the icon's bottom anchor (circle-translate) so it peeks out from the
  // base of the marker rather than getting hidden by the icon body.
  // Filtered to features with tintable=false; tintable pins draw their
  // color via icon-color and don't need the ring. Added BEFORE the fill
  // layer so it z-stacks underneath.
  if (!mapInstance.getLayer(PINS_COLOR_RING_LAYER_ID)) {
    // Radius/translate/stroke seed from currentPinStyle so a styledata
    // re-add after a basemap swap paints the ring at whatever size was last
    // configured, not the pre-Pin-style-feature baseline — the defensive
    // applyPinStyleToLayers() call at the end of this function then
    // reconciles it (harmless no-op the first time since the values already
    // match).
    const iconScale = currentPinStyle.size / BASE_PIN_ICON_SIZE;
    mapInstance.addLayer({
      id: PINS_COLOR_RING_LAYER_ID,
      type: "circle",
      source: PINS_SOURCE_ID,
      filter: ["==", ["get", "tintable"], false],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": PINS_COLOR_RING_BASE_RADIUS * iconScale,
        "circle-translate": [0, PINS_COLOR_RING_BASE_TRANSLATE_Y * iconScale],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": PINS_COLOR_RING_BASE_STROKE_WIDTH * iconScale,
      },
    });
  }

  // Single fill layer for all pins. SDF: icon-color tints the silhouette
  // via ['get', 'color'], reading the materialized effectiveColor() from
  // each feature's properties. icon-image is data-driven the same way:
  // a coalesce expression reads pin.icon and falls back to map-pin so
  // pre-icon-picker pins (no `icon` field) render unchanged.
  //
  // The white halo replaces PO-003's separate shadow companion image.
  // Halo width gives the inner-contour cue against any basemap; halo
  // blur gives a soft glow that reads as a shadow without committing to
  // a lighting direction.
  if (!mapInstance.getLayer(PINS_LAYER_ID)) {
    mapInstance.addLayer({
      id: PINS_LAYER_ID,
      type: "symbol",
      source: PINS_SOURCE_ID,
      layout: {
        // pin.icon stores the short public id ("map-pin", "star", …);
        // the actual MapLibre image id is namespaced to avoid basemap
        // sprite collisions, so we concat the prefix here at expression
        // evaluation time. The coalesce fallback covers pre-PI-001 pins
        // (no `icon` field) by routing them to the default drop-pin.
        "icon-image": [
          "concat",
          PIN_ICON_IMAGE_PREFIX,
          ["coalesce", ["get", "icon"], DEFAULT_PIN_ICON],
        ],
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": currentPinStyle.size / BASE_PIN_ICON_SIZE,
      },
      paint: {
        "icon-color": ["get", "color"],
        "icon-opacity": 1,
        "icon-halo-color": "#ffffff",
        "icon-halo-width": 1.5,
        "icon-halo-blur": 2,
      },
    });
  }

  // Pin name labels. Same source as the fill layer — every renderPins
  // setData() call propagates here automatically, so renames/adds/removes
  // /drags/group-color swaps update labels without a separate subscription.
  // Added LAST so MapLibre's add-order z-stacking paints labels above
  // pins. text-color is fixed (not bound to the pin's color) so labels
  // stay readable regardless of marker tint, per PO-002.
  if (!mapInstance.getLayer(PINS_LABELS_LAYER_ID)) {
    mapInstance.addLayer({
      id: PINS_LABELS_LAYER_ID,
      type: "symbol",
      source: PINS_SOURCE_ID,
      layout: {
        "text-field": ["get", "name"],
        // Noto Sans Regular/Bold are the fonts the OpenFreeMap basemap uses
        // for its own labels, so we know both glyph PBFs exist at the
        // expected URL. The previous combo "Open Sans Regular,Arial Unicode
        // MS Regular" 404'd silently — fine when markers were a non-symbol
        // circle layer, but PO-003 puts pin icons into the same symbol
        // bucket and a failed glyph load on this layer suppresses the icons
        // too. currentPinStyle.labelBold picks between the two; an
        // arbitrary labelFont family is NOT wired here (see setPinStyle's
        // doc comment) because nothing guarantees the active basemap's
        // glyph endpoint serves any font beyond this pair.
        "text-font": [currentPinStyle.labelBold ? "Noto Sans Bold" : "Noto Sans Regular"],
        "text-size": currentPinStyle.labelSize,
        "text-anchor": "top",
        // Data-driven (draggable labels): reads the per-feature `labelOffset`
        // ([x,y] in ems) materialized by pinsToFeatureCollection/
        // computeLabelOffsetEms, so a per-pin label drag renders without a
        // second layer or a static baseline that ignores pin.labelDx/Dy.
        "text-offset": ["get", "labelOffset"],
        "text-padding": 4,
        // allow-overlap/ignore-placement: true — MapLibre's symbol
        // collision culling was dropping labels (and would drop pins too,
        // if icon-allow-overlap above were ever false) once enough markers
        // crowded together at a given zoom. Labels/pins are the app's own
        // small, finite dataset (tens of pins per CLAUDE.md), so the
        // overdraw risk from disabling culling is negligible next to a
        // label silently vanishing while zooming.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": currentPinStyle.labelColor,
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
        "text-halo-blur": 0.5,
      },
    });
  }

  // Defensive re-apply: covers the case where SOME of the three layers
  // above already existed (their `if (!getLayer(...))` guard skipped
  // creation) while others were just freshly created from currentPinStyle
  // directly. Also the only path that keeps an already-existing layer set
  // in sync after setPinStyle() runs before a styledata cycle finishes
  // re-adding layers. No-op (identical values) in the common case where
  // every layer was just created fresh above.
  applyPinStyleToLayers();
}

// Hover + drag wiring on the LABEL layer only. The pin itself is never
// draggable — a mousedown on a pin falls through untouched so the map pans
// normally exactly as if no marker were there. Only a pin's text label can
// be dragged, which sets a per-pin screen-pixel offset (pin.labelDx/
// labelDy) rather than moving the pin's true lat/lon.
//
// Idempotent across style swaps: MapLibre keeps `map.on(eventType,
// layerId, handler)` listeners through setStyle() because they're attached
// to the map, not to layer instances. We only register them once at init
// time.
function attachPinInteractions() {
  if (!mapInstance) return;

  // Hover cursor feedback: grab affordance only over a label, never over a
  // pin (which isn't draggable and shouldn't promise a drag it won't
  // deliver).
  mapInstance.on("mouseenter", PINS_LABELS_LAYER_ID, () => {
    if (!dragState) mapInstance.getCanvas().style.cursor = "grab";
  });
  mapInstance.on("mouseleave", PINS_LABELS_LAYER_ID, () => {
    if (!dragState) mapInstance.getCanvas().style.cursor = "";
  });

  mapInstance.on("mousedown", PINS_LABELS_LAYER_ID, (e) => {
    if (dragState) return; // a drag is already in flight
    if (e.originalEvent.button !== 0) return;
    const feature = e.features?.[0];
    if (!feature) return;
    startLabelDrag(e, feature);
  });
  // No mousedown handler on PINS_LAYER_ID: a click on a pin is intentionally
  // left unhandled so MapLibre's default pan behavior takes over — pins are
  // fixed in place and never intercept the map's own drag gesture.
}

function startLabelDrag(e, feature) {
  e.preventDefault();
  e.originalEvent.stopPropagation();

  mapInstance.dragPan.disable();
  document.body.classList.add("dragging-pin");
  mapInstance.getCanvas().style.cursor = "grabbing";

  const pinId = feature.properties.id;
  const pin = lastPinsSnapshot.find((p) => p.id === pinId);
  const startDx = pin && Number.isFinite(pin.labelDx) ? pin.labelDx : 0;
  const startDy = pin && Number.isFinite(pin.labelDy) ? pin.labelDy : 0;

  dragState = {
    pinId,
    startClientX: e.originalEvent.clientX,
    startClientY: e.originalEvent.clientY,
    startDx,
    startDy,
    // Mirrors the live value onDocMove writes as the cursor moves; onDocUp
    // commits whatever this holds at mouseup.
    lastDx: startDx,
    lastDy: startDy,
  };

  document.addEventListener("mousemove", onDocMove);
  document.addEventListener("mouseup", onDocUp);
  // mouseleave on document fires when the cursor exits the window —
  // commit there so a drag ending off-screen doesn't leak listeners.
  document.addEventListener("mouseleave", onDocUp);
}

function onDocMove(ev) {
  if (!dragState || !mapInstance) return;

  // Constant-offset drag: the label moves by exactly the mouse's screen
  // delta from mousedown, added on top of whatever offset it already had.
  // No projection math needed — text-offset only cares about the delta
  // from the anchor, not the pin's on-screen position.
  const dx = dragState.startDx + (ev.clientX - dragState.startClientX);
  const dy = dragState.startDy + (ev.clientY - dragState.startClientY);
  dragState.lastDx = dx;
  dragState.lastDy = dy;
  const updated = lastPinsSnapshot.map((p) =>
    p.id === dragState.pinId ? { ...p, labelDx: dx, labelDy: dy } : p
  );
  lastPinsSnapshot = updated;
  const source = mapInstance.getSource(PINS_SOURCE_ID);
  if (source) source.setData(pinsToFeatureCollection(updated));
}

function onDocUp() {
  if (!dragState || !mapInstance) return;
  const { pinId, lastDx, lastDy } = dragState;
  dragState = null;

  document.removeEventListener("mousemove", onDocMove);
  document.removeEventListener("mouseup", onDocUp);
  document.removeEventListener("mouseleave", onDocUp);

  mapInstance.dragPan.enable();
  document.body.classList.remove("dragging-pin");
  mapInstance.getCanvas().style.cursor = "";

  // Routing the new offset through updatePin keeps storage and the pin
  // list in sync. The resulting renderPins call repaints the source with
  // the same offset we already drew, so it's effectively a no-op here.
  updatePin(pinId, { labelDx: lastDx, labelDy: lastDy });
}
