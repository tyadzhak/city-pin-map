// App bootstrap. Wires modules together once the DOM is ready.
// Other modules reach the map via map.js → getMap(), so app.js doesn't
// need to re-export it.
import {
  initMap,
  renderPins,
  renderRoute,
  getMap,
  setMapStyle,
  onStyleRendered,
  MAP_STYLES,
  DEFAULT_MAP_STYLE_ID,
  applyLabelVisibility,
  isRasterStyleEntry,
  setPinStyle,
} from "./map.js";
import * as pinStore from "./pins.js";
import * as groupStore from "./groups.js";
import * as userIconStore from "./user-icons.js";
import * as settings from "./settings.js";
import {
  attachStorage,
  attachGroupStorage,
  attachUserIconStorage,
  loadMapStyle,
  loadRouteVisible,
  saveRouteVisible,
  loadExportFormat,
  saveExportFormat,
  loadExportFrame,
  saveExportFrame,
  normalizeFrameSet,
  loadBottomFade,
  saveBottomFade,
  normalizeBottomFade,
  loadInset,
  saveInset,
  normalizeInset,
  loadHideLabels,
  saveHideLabels,
  loadOnMapTitle,
  saveOnMapTitle,
  defaultTitleLine,
  ON_MAP_TITLE_FONTS,
  loadPinStyle,
  savePinStyle,
  normalizePinStyle,
  showError,
} from "./storage.js";
import { exportMapAsPng, EXPORT_PRESETS } from "./export.js";
import { exportToJson, importFromJson } from "./backup.js";
import { importFromFile } from "./import-foreign.js";
import { initSearch } from "./search.js";
import { initPinList } from "./pin-list.js";
import { initGroupPanel } from "./group-panel.js";
import { initSettingsPanel, openSettingsScrolledTo } from "./settings-panel.js";
import { initStylePicker } from "./style-picker.js";
import { initSideTabs } from "./side-tabs.js";
import * as mapTitle from "./map-title.js";
import * as mapFrame from "./map-frame.js";
import * as mapFade from "./map-fade.js";
import * as mapViewport from "./map-viewport.js";
import * as mapInset from "./map-inset.js";
import * as mapLabels from "./map-labels.js";

// The live inset handle, exposed at module scope so the frame-control wiring
// (initExportFrameOptions) can trigger a re-dock/re-clamp of the inset whenever
// a frame changes — the inset docks INSIDE the innermost enabled frame band, so
// a frame edit must move it. Set in init(); null on a headless/no-map boot.
let insetHandle = null;

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

  initMap("map", initialStyleId);
  // Tracks the currently-rendered style id for downstream consumers. The
  // map module's currentRenderedStyleId is private; mirroring it here lets
  // the hide-labels notice re-evaluate whenever the basemap swaps.
  let activeStyleId = initialStyleId;
  const pickerHandle = initStylePicker({
    // Read the LIVE mirror, not the boot-time id — the picker may re-read
    // this at any time and must see the currently-active style.
    getCurrentStyleId: () => activeStyleId,
    onSelect: (id) => {
      // Optimistic: update UI immediately for responsiveness. If the swap
      // FAILS, map.js reverts and fires onStyleRendered with the reverted
      // id, and the subscription below corrects activeStyleId + the picker
      // + the notice back to the actually-rendered style.
      activeStyleId = id;
      setMapStyle(id);
      // The map's styledata handler re-applies label visibility; we just
      // need to refresh the inline notice for the new style.
      refreshHideLabelsNotice();
    },
    onOpenSettings: (provider) => {
      // null provider = generic "Manage API keys" footer click; default
      // to the first section (Stadia).
      openSettingsScrolledTo(provider ?? "stadia");
    },
  });

  // Authoritative correction path: fires whenever a style actually RENDERS
  // (successful swap OR the revert after a failed swap). This is what keeps
  // the trigger label, active row, activeStyleId mirror, and hide-labels
  // notice pointing at the real rendered style. We only update UI state
  // here — never call setMapStyle — so the revert can't loop.
  onStyleRendered((styleId) => {
    activeStyleId = styleId;
    pickerHandle.setActive(styleId);
    refreshHideLabelsNotice();
  });
  attachStorage(pinStore);
  // Hydrate the group store BEFORE initGroupPanel — same rationale as
  // attachStorage above: the panel's first render must reflect persisted
  // groups, and reversing the order would write `[]` straight back to disk.
  attachGroupStorage(groupStore);

  // Hydrate user-icon library BEFORE the icon registry's subscribers fire.
  // Same hydrate-then-subscribe contract as attachStorage / attachGroupStorage.
  // The icon registry (js/icons.js, added in Task 4) subscribes to user-icons
  // at module-eval time, so this attach call must run before any module that
  // imports icons.js triggers a registry rebuild.
  attachUserIconStorage(userIconStore);

  // Route visibility lives as a closure variable so the pin-store
  // subscription and the toggle's change handler share one source of
  // truth without exposing a module-global. The toggle setup mutates it
  // and returns nothing — both reads below close over the latest value.
  let routeVisible = loadRouteVisible();

  // Render once with hydrated state, then keep markers in sync with every
  // future change. Subscribing AFTER attachStorage matches the order the
  // spec describes; the manual call below covers the pins loaded during
  // hydration (which fired notify() before we were listening).
  pinStore.subscribe(renderPins);
  pinStore.subscribe((snapshot) => renderRoute(snapshot, { visible: routeVisible }));
  // Group changes (create / rename / recolor / delete) all alter the
  // effective color a marker should render with (NICE-005). The cheapest
  // way to keep markers honest is to re-render the full marker set against
  // the latest pin snapshot whenever the group store ticks.
  groupStore.subscribe(() => renderPins(pinStore.listPins()));
  renderPins(pinStore.listPins());
  renderRoute(pinStore.listPins(), { visible: routeVisible });

  // Side-panel pin list. Subscribes internally and runs an initial render
  // to backfill the hydration notify() that fired during attachStorage.
  initPinList();

  // Groups panel: spec orders this AFTER initPinList so the side-panel
  // heading order stays predictable (NICE-004 implementation prompt).
  initGroupPanel();

  // Side-tabs restructuring: activate the last-used Design/Pins/Groups tab.
  // Runs after the panel-specific inits above so their DOM (pin list rows,
  // group rows) already exists by the time a hidden panel is revealed.
  initSideTabs();

  // Search wires the header input to the geocoder + pin store. It must run
  // after the DOM is ready (we're already inside DOMContentLoaded) and
  // doesn't depend on the map directly — pin additions flow through the
  // store and reach the map via the subscription above.
  initSearch();

  initRouteToggle({
    initialValue: routeVisible,
    onChange: (next) => {
      routeVisible = next;
      saveRouteVisible(next);
      // Pin-store subscription only fires on pin changes, so the toggle
      // has to push the new visibility through itself or the line won't
      // appear/disappear until the next add/remove/drag.
      renderRoute(pinStore.listPins(), { visible: next });
    },
  });

  // PO-001: hide-labels toggle. Hydrating BEFORE wiring change events
  // means the first styledata firing (triggered by initMap above) reads
  // the correct value via loadHideLabels() — no flash of labelled tiles
  // before the toggle's initial value is applied.
  let hideLabels = loadHideLabels();
  refreshHideLabelsNotice();
  initHideLabelsToggle({
    initialValue: hideLabels,
    onChange: (next) => {
      hideLabels = next;
      saveHideLabels(next);
      // The map module reads loadHideLabels() on every styledata. We can
      // shortcut the loop here so the user sees labels disappear/return
      // within the same frame the toggle flips, without waiting for the
      // next basemap swap.
      applyLabelVisibility(next);
      pickerHandle.setHideLabels(next);
      refreshHideLabelsNotice();
      // The inset seeds its basemap from the main map's style, which carries
      // the layer visibility applyLabelVisibility just flipped. Re-seed it so a
      // currently-visible inset re-syncs immediately; a hidden inset just gets
      // marked stale and picks the change up on its next enable. insetHandle is
      // assigned later in init() but this closure only runs on user interaction,
      // by which point it's set.
      if (insetHandle) insetHandle.refreshStyle();
    },
  });

  // Closure over activeStyleId + hideLabels so a single helper covers
  // both code paths (toggle flip, basemap swap). Defined inside init so
  // it can read the local `hideLabels` variable rather than re-reading
  // from storage on every call.
  function refreshHideLabelsNotice() {
    const notice = document.getElementById("hide-labels-notice");
    if (!notice) return;
    const entry = MAP_STYLES.find((s) => s.id === activeStyleId);
    const showNotice = hideLabels && entry && isRasterStyleEntry(entry);
    notice.hidden = !showNotice;
  }

  // Global pin style (size/label size/label color/label bold). Hydrates
  // map.js's currentPinStyle baseline before the map's first `load` handler
  // (async, gated on tile/sprite/glyph fetch) creates the pin/label layers,
  // so the very first paint already reflects any previously-saved custom
  // style — no flash of default-sized pins.
  initPinStyleOptions();

  // Pin-label DOM overlay (js/map-labels.js). Inited AFTER initPinStyleOptions
  // (so the global pin style is already applied — the overlay's first render
  // picks up the saved typography) and after the pin/group stores are hydrated
  // and subscribed above, honoring the hydrate-before-subscribe boot order:
  // the overlay subscribes to both stores and renders once immediately, so it
  // must see hydrated pins/groups. No UI controls here — the pin-style group
  // and (later) the labelFont/labelItalic controls own those.
  mapLabels.init(getMap());

  initExportFormatSelector();
  // Capture the live-state accessors so the export button consumes the same
  // in-memory frame/title the on-map overlays render from (FBL-013), rather
  // than re-reading localStorage inside the export pipeline. Either handle is
  // undefined if its init bailed (missing DOM / no map); the button then
  // passes nothing and export.js falls back to the persisted value.
  const exportFrameHandle = initExportFrameOptions();
  const bottomFadeHandle = initBottomFadeOptions();
  const onMapTitleHandle = initOnMapTitle();
  insetHandle = initInset();
  initInsetOptions(insetHandle);
  initExportButton({
    getFrame: exportFrameHandle?.getLiveFrame,
    getOnMapTitle: onMapTitleHandle?.getLivePosition,
    getBottomFade: bottomFadeHandle?.getLiveFade,
  });
  initBackupControls();
  initImportFromFileControl();
  initSettingsPanel();
}

// Hydrates the format selector from localStorage and persists every
// change. The export pipeline reads the current value back out of the
// DOM at click time, so this function only owns persistence — it does
// not need to notify any other module when the value flips.
//
// An unknown saved id (older app version, hand-edited storage) falls
// through to the <select>'s first option, which the HTML pins to
// "current" — so corruption degrades to the safe default.
//
// Also drives js/map-viewport.js: whenever the selected preset changes (on
// boot from the persisted value, and on every subsequent `change`), the
// live `#map` is letterboxed to that preset's aspect ratio so the on-screen
// view previews exactly what Export PNG will crop (WYSIWYG). Guarded for a
// missing map (initMap failed) so persistence still works headless.
function initExportFormatSelector() {
  const select = document.getElementById("export-format");
  if (!select) return;

  const map = getMap();
  const viewport = map ? mapViewport.init(map) : undefined;

  const saved = loadExportFormat();
  const isKnown = Array.from(select.options).some((o) => o.value === saved);
  if (isKnown) select.value = saved;

  viewport?.setPreset(EXPORT_PRESETS[select.value] ?? null);

  select.addEventListener("change", (event) => {
    saveExportFormat(event.target.value);
    viewport?.setPreset(EXPORT_PRESETS[event.target.value] ?? null);
    // The title's anchor (nx/ny) is a normalized frame-relative fraction,
    // so it stays visually put across the letterbox resize above — but a
    // title dragged off-center under one aspect ratio can end up oddly
    // placed under another. Re-center horizontally (ny/vertical position
    // is left alone) so a portrait↔landscape switch always reads centered.
    // Deliberately NOT called on the boot-time setPreset() above this
    // handler — only on an explicit user change.
    mapTitle.recenterX();
  });
}

// Hydrates BOTH frames' seven inputs each (PO-007, extended to two
// independently configured frames sharing the same 7-field shape) from
// localStorage, persists every change, and drives the live WYSIWYG overlay
// (js/map-frame.js) so both frames are previewed on the map itself instead
// of only appearing after export. Each frame's wrapper `data-frame-enabled`
// attribute still drives CSS visibility for its own dependent controls — see
// .export-frame-controls in css/styles.css. The export pipeline reads each
// frame's inputs back out of the DOM at click time, so this function's
// persistence half doesn't need to notify anything else.
//
// wireFrameControls(suffix) below wires ONE frame's cluster (e.g. "-1" or
// "-2") and returns its own readFrame() closure; if any of that frame's
// seven elements is missing from the DOM, that frame is skipped defensively
// (returns null) rather than crashing the whole init — the other frame (and
// the rest of the app) still wires up normally.
function initExportFrameOptions() {
  // The live overlay needs a map to attach to; on a boot path where initMap
  // failed outright there's nothing to preview, so just skip that half and
  // still let the (non-visual) persistence wiring below work normally.
  const map = getMap();
  if (map) mapFrame.init(map);

  const saved = loadExportFrame();
  const frame1 = wireFrameControls("-1", saved.frames[0]);
  const frame2 = wireFrameControls("-2", saved.frames[1]);
  const outside = wireFrameOutsideControls(saved.outside);
  if (!frame1 && !frame2 && !outside) return undefined;

  // Builds the full FRAME SET straight from the DOM — the single read path
  // both persist() and the live-overlay update share, so they can never
  // disagree about what's currently on screen. A frame/cluster whose
  // controls are missing from the DOM falls back to its own stored/default
  // value (never crashes, never silently vanishes from the persisted set).
  const readFrameSet = () => ({
    frames: [
      frame1 ? frame1.readFrame() : saved.frames[0],
      frame2 ? frame2.readFrame() : saved.frames[1],
    ],
    outside: outside ? outside.readOutside() : saved.outside,
  });

  const persist = () => {
    const next = readFrameSet();
    saveExportFrame(next);
    if (map) mapFrame.update(next);
    // The corner-docked inset sits inside the innermost enabled frame band, so
    // a frame change shifts where it docks (and re-clamps a free-dragged box
    // into the new inner rect). Re-run the placement immediately. Reads the
    // module-scoped handle set later in init(): null during this function's own
    // boot-time mapFrame.update(saved) below — harmless, because initInset()
    // runs AFTER and docks against the freshly-applied frame state.
    if (insetHandle) insetHandle.refreshPlacement();
  };
  if (frame1) frame1.onChange(persist);
  if (frame2) frame2.onChange(persist);
  if (outside) outside.onChange(persist);

  // Reflect the persisted state on the overlay at boot, same as
  // mapTitle.update(saved) in initOnMapTitle — otherwise the live preview
  // would stay blank until the user next touches a frame control.
  if (map) mapFrame.update(saved);

  // FBL-013: expose a LIVE frame-set accessor so the export button reads the
  // same in-memory state the overlay renders from — normalized through the
  // very same normalizeFrameSet() that loadExportFrame() applies — instead
  // of re-reading (possibly stale) localStorage at click time. readFrameSet()
  // is the same DOM read persist()/mapFrame.update() use, so the export and
  // the preview can never disagree, even after a "kept in memory only" save.
  return { getLiveFrame: () => normalizeFrameSet(readFrameSet()) };
}

// Wires one frame's 7-field control cluster (ids suffixed by `suffix`, e.g.
// "-1"/"-2"): hydrates from `savedFrameEl`, wires input listeners, and
// returns `{ readFrame, onChange }` — or null if any of the seven elements
// is missing, so a malformed/edited-by-hand index.html degrades to "skip
// this frame" rather than crashing every frame's init.
function wireFrameControls(suffix, savedFrameEl) {
  const enabled = document.getElementById(`export-frame-enabled${suffix}`);
  const thickness = document.getElementById(`export-frame-thickness${suffix}`);
  const color = document.getElementById(`export-frame-color${suffix}`);
  const padding = document.getElementById(`export-frame-padding${suffix}`);
  const margin = document.getElementById(`export-frame-margin${suffix}`);
  const radius = document.getElementById(`export-frame-radius${suffix}`);
  const shadow = document.getElementById(`export-frame-shadow${suffix}`);
  const wrapper = document.getElementById(`export-frame-controls${suffix}`);
  if (
    !enabled ||
    !thickness ||
    !color ||
    !padding ||
    !margin ||
    !radius ||
    !shadow ||
    !wrapper
  )
    return null;

  // Builds this frame's 7-field FRAME OBJECT straight from the DOM — the
  // single read path both persist() and the live-overlay update share, so
  // they can never disagree about what's currently on screen.
  const readFrame = () => ({
    enabled: enabled.checked,
    thickness: thickness.valueAsNumber,
    color: color.value,
    shadow: shadow.checked,
    padding: padding.valueAsNumber,
    margin: margin.valueAsNumber,
    radius: radius.valueAsNumber,
  });

  enabled.checked = savedFrameEl.enabled;
  thickness.value = String(savedFrameEl.thickness);
  color.value = savedFrameEl.color;
  padding.value = String(savedFrameEl.padding);
  margin.value = String(savedFrameEl.margin);
  radius.value = String(savedFrameEl.radius);
  shadow.checked = savedFrameEl.shadow;
  wrapper.dataset.frameEnabled = savedFrameEl.enabled ? "true" : "false";

  const onChange = (persist) => {
    enabled.addEventListener("change", () => {
      wrapper.dataset.frameEnabled = enabled.checked ? "true" : "false";
      persist();
    });
    // `input` instead of `change` for the number/color inputs so the user
    // sees the persisted state (and the live overlay) update as they scrub a
    // value, mirroring the immediate-save behaviour of the title/subtitle
    // text inputs.
    thickness.addEventListener("input", persist);
    color.addEventListener("input", persist);
    padding.addEventListener("input", persist);
    margin.addEventListener("input", persist);
    radius.addEventListener("input", persist);
    shadow.addEventListener("change", persist);
  };

  return { readFrame, onChange };
}

// Wires the "outside the frame" treatment cluster (mode select + color +
// blur inputs). Sibling of wireFrameControls: same "return null if any
// element is missing" defensive contract, so a malformed/edited-by-hand
// index.html skips just this cluster rather than crashing all of
// initExportFrameOptions. The wrapper's `data-outside-mode` attribute
// drives which of color/blur is shown — see .frame-outside-controls in
// css/styles.css — mirroring `data-frame-enabled` above.
function wireFrameOutsideControls(savedOutside) {
  const mode = document.getElementById("frame-outside-mode");
  const color = document.getElementById("frame-outside-color");
  const blur = document.getElementById("frame-outside-blur");
  const wrapper = document.getElementById("frame-outside-controls");
  if (!mode || !color || !blur || !wrapper) return null;

  // Single read path both persist() and the live-overlay update share, so
  // they can never disagree about what's currently on screen. Normalization
  // (mode enum, color hex, blur clamp 0-50) happens at the storage.js
  // boundary (normalizeFrameOutside, via normalizeFrameSet/saveExportFrame),
  // same as wireFrameControls's readFrame — this function just reflects the
  // raw DOM state.
  const readOutside = () => ({
    mode: mode.value,
    color: color.value,
    blur: blur.valueAsNumber,
  });

  mode.value = savedOutside.mode;
  color.value = savedOutside.color;
  blur.value = String(savedOutside.blur);
  wrapper.dataset.outsideMode = savedOutside.mode;

  const onChange = (persist) => {
    mode.addEventListener("change", () => {
      wrapper.dataset.outsideMode = mode.value;
      persist();
    });
    // `input` instead of `change` for color/blur so the live overlay updates
    // as the user scrubs a value, mirroring the frame controls' behaviour.
    color.addEventListener("input", persist);
    blur.addEventListener("input", persist);
  };

  return { readOutside, onChange };
}

// Bottom fade (poster-style caption zone). Sibling of initExportFrameOptions:
// hydrates the toggle/height/color inputs from localStorage, persists every
// change, and drives the live WYSIWYG overlay (js/map-fade.js) so the fade
// previews on the map itself instead of only appearing after export. The
// wrapper's `data-fade-enabled` attribute drives CSS visibility for the
// dependent height/color inputs — see .bottom-fade-controls in
// css/styles.css. Defensive-returns undefined if any control (or the map
// itself) is missing, mirroring initExportFrameOptions's per-cluster bail.
function initBottomFadeOptions() {
  const enabled = document.getElementById("bottom-fade-enabled");
  const height = document.getElementById("bottom-fade-height");
  const intensity = document.getElementById("bottom-fade-intensity");
  const color = document.getElementById("bottom-fade-color");
  const controls = document.getElementById("bottom-fade-controls");
  if (!enabled || !height || !intensity || !color || !controls) return undefined;

  // The live overlay needs a map to attach to; on a boot path where initMap
  // failed outright there's nothing to preview, so just skip that half and
  // still let the (non-visual) persistence wiring below work normally.
  const map = getMap();
  if (map) mapFade.init(map);

  // Single read path both persist() and the live-overlay update share, so
  // they can never disagree about what's currently on screen. Empty field
  // (briefly-NaN valueAsNumber mid-edit) reads as 0 for both height and
  // intensity, so the preview and export never diverge on an empty input.
  const readFade = () => ({
    enabled: enabled.checked,
    height: Number.isFinite(height.valueAsNumber) ? height.valueAsNumber : 0,
    intensity: Number.isFinite(intensity.valueAsNumber) ? intensity.valueAsNumber : 0,
    color: color.value,
  });

  const saved = loadBottomFade();
  enabled.checked = saved.enabled;
  height.value = String(saved.height);
  intensity.value = String(saved.intensity);
  color.value = saved.color;
  controls.dataset.fadeEnabled = saved.enabled ? "true" : "false";

  // Reflect the persisted state on the overlay at boot, same as
  // mapFrame.update(saved) in initExportFrameOptions — otherwise the live
  // preview would stay blank until the user next touches a fade control.
  if (map) mapFade.update(saved);

  const persist = () => {
    const next = readFade();
    saveBottomFade(next);
    if (map) mapFade.update(next);
  };

  enabled.addEventListener("change", () => {
    controls.dataset.fadeEnabled = enabled.checked ? "true" : "false";
    persist();
  });
  // `input` instead of `change` for the number/color inputs so the live
  // overlay updates as the user scrubs a value, mirroring the frame
  // controls' behaviour.
  height.addEventListener("input", persist);
  intensity.addEventListener("input", persist);
  color.addEventListener("input", persist);

  // FBL-013-style live accessor so the export button reads the same
  // in-memory state the overlay renders from — normalized through the very
  // same normalizeBottomFade() that loadBottomFade() applies — instead of
  // re-reading (possibly stale) localStorage at click time.
  return { getLiveFade: () => normalizeBottomFade(readFade()) };
}

// Corner inset map (atlas-style magnifier). Inits the overlay module and
// pushes the persisted config once at boot, so a user who previously
// enabled the inset sees it restored on load (default config is disabled,
// so the common boot is a no-op). Guarded for a missing map (initMap
// failed) so a headless boot doesn't throw — returns undefined in that
// case, which initInsetOptions treats as "no handle, skip UI wiring".
//
// Returns the mapInset handle ({ update, getInsetMap, getPlacement,
// getBoundsInUse }) so initInsetOptions (Design-tab UI, below) can push
// every control change straight through without re-deriving it.
function initInset() {
  const map = getMap();
  if (!map) return undefined;
  const insetApi = mapInset.init(map);
  insetApi.update(loadInset());
  return insetApi;
}

// Design-tab "Inset map" group: hydrates the toggle/group/corner/size/
// locator controls from localStorage, persists every change, and pushes the
// normalized config through the live inset overlay via `insetHandle.update`.
// Sibling of initBottomFadeOptions/initExportFrameOptions in shape (hydrate
// → wire → persist-and-apply), but with an extra wrinkle: the group <select>
// must stay in sync with the LIVE group store (create/rename/delete), not
// just be populated once at boot, and its selection must fall back to the
// placeholder ("") whenever the currently-selected group id no longer
// exists in the store — the stale id itself stays intact in the persisted
// cfg (per the stale-group-reference contract; js/map-inset.js is what
// actually hides the inset for an unresolvable id), only the UI reflects
// "".
//
// Defensive: if any control is missing from the DOM, or the inset handle
// itself is undefined (initInset bailed on a missing map), skip wiring
// entirely rather than partially wiring against a broken cluster — same
// bail contract as wireFrameControls/initBottomFadeOptions.
function initInsetOptions(insetHandle) {
  const enabled = document.getElementById("inset-enabled");
  const groupSelect = document.getElementById("inset-group");
  const cornerSelect = document.getElementById("inset-corner");
  const sizeInput = document.getElementById("inset-size");
  const sizeValue = document.getElementById("inset-size-value");
  const locator = document.getElementById("inset-locator");
  const controls = document.getElementById("inset-controls");
  const groupHint = document.getElementById("inset-group-hint");
  if (
    !enabled ||
    !groupSelect ||
    !cornerSelect ||
    !sizeInput ||
    !locator ||
    !controls
  ) {
    return;
  }

  const saved = loadInset();

  // Rebuilds the group <select>'s options from the live group store,
  // preserving whichever group id is currently selected when it still
  // exists; falls back to the placeholder ("") otherwise. Called once at
  // boot (seeded with the persisted groupId) and again on every group-store
  // change, mirroring initGroupPanel's own live-render contract.
  function renderGroupOptions(preserveId) {
    const groups = groupStore.listGroups();
    const stillExists = groups.some((g) => g.id === preserveId);
    groupSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "(choose a group)";
    groupSelect.appendChild(placeholder);
    for (const g of groups) {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      groupSelect.appendChild(opt);
    }
    groupSelect.value = stillExists ? preserveId : "";
    if (groupHint) groupHint.hidden = groups.length > 0;
  }

  renderGroupOptions(saved.groupId);
  cornerSelect.value = saved.corner;
  sizeInput.value = String(saved.sizePct);
  if (sizeValue) sizeValue.textContent = `${saved.sizePct}%`;
  locator.checked = saved.showLocator;
  enabled.checked = saved.enabled;
  controls.dataset.insetEnabled = saved.enabled ? "true" : "false";

  // Single read path both persist() and the live-overlay update share, so
  // they can never disagree about what's currently on screen. An empty
  // group-select value always means "no group" (groupId: null) — the
  // select can never show a stale id (renderGroupOptions resets it to ""
  // the moment the id stops existing), so this is the one place the
  // stale-id-becomes-null translation happens for the UI layer.
  //
  // freePos (the box's dragged position) is owned by js/map-inset.js, which
  // saves it directly on drag-end. This UI layer has no control for it, so it
  // must PRESERVE whatever is persisted (read back via loadInset) on every
  // control change — otherwise adjusting size/group/etc. after a drag would
  // wipe the custom position. The one exception is picking a corner, which
  // deliberately re-docks: `clearFree` forces freePos back to null.
  const readInset = (clearFree = false) => ({
    enabled: enabled.checked,
    corner: cornerSelect.value,
    sizePct: sizeInput.valueAsNumber,
    groupId: groupSelect.value || null,
    showLocator: locator.checked,
    freePos: clearFree ? null : loadInset().freePos,
  });

  const persist = (clearFree = false) => {
    const next = normalizeInset(readInset(clearFree));
    saveInset(next);
    if (insetHandle) insetHandle.update(next);
  };

  enabled.addEventListener("change", () => {
    controls.dataset.insetEnabled = enabled.checked ? "true" : "false";
    persist();
  });
  groupSelect.addEventListener("change", () => persist());
  // Choosing a corner re-docks the box: clear the dragged freePos.
  cornerSelect.addEventListener("change", () => persist(true));
  // `input` for the live-drag slider (mirrors the frame/fade number
  // fields' `input` wiring) so the readout + live overlay track the drag in
  // real time, not just on release.
  sizeInput.addEventListener("input", () => {
    if (sizeValue) sizeValue.textContent = `${sizeInput.value}%`;
    persist();
  });
  locator.addEventListener("change", () => persist());

  // Keep the group <select> honest across the group store's entire
  // lifecycle (create/rename/recolor/delete) — not just at boot. Reads the
  // CURRENT select value (not `saved.groupId`) as the id to preserve, so a
  // rename after boot doesn't get reverted back to the original selection.
  groupStore.subscribe(() => renderGroupOptions(groupSelect.value));
}

// Global pin style (Design tab "Pin style" group, this batch's item 4).
// Unlike the per-line title editor and the two frames, this is a single
// flat control cluster — no add/remove, no enable toggle (pins are always
// on) — so it's a much smaller version of initBottomFadeOptions' shape:
// hydrate from storage, apply once, persist + re-apply on every change.
//
// Clamped at the UI layer too (mirrors the on-map title size input's
// clampSize helper) so the input box, the live map, and the persisted
// value can never disagree even mid-edit.
function initPinStyleOptions() {
  const sizeInput = document.getElementById("pin-style-size");
  const labelSizeInput = document.getElementById("pin-style-label-size");
  const labelColorInput = document.getElementById("pin-style-label-color");
  const labelBoldBtn = document.getElementById("pin-style-label-bold");
  const labelItalicBtn = document.getElementById("pin-label-italic");
  const labelFontSelect = document.getElementById("pin-label-font");
  if (!sizeInput || !labelSizeInput || !labelColorInput || !labelBoldBtn) {
    return;
  }

  const clamp = (n, min, max, fallback) =>
    Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;

  const saved = loadPinStyle();
  sizeInput.value = String(saved.size);
  labelSizeInput.value = String(saved.labelSize);
  labelColorInput.value = saved.labelColor;
  labelBoldBtn.setAttribute("aria-pressed", saved.labelBold ? "true" : "false");
  if (labelItalicBtn) {
    labelItalicBtn.setAttribute("aria-pressed", saved.labelItalic ? "true" : "false");
  }
  if (labelFontSelect) {
    labelFontSelect.value = saved.labelFont;
  }

  // Apply immediately so the map reflects a previously-saved custom style
  // from its very first paint (see the comment at the call site in init()).
  setPinStyle(saved);

  // labelFont/labelItalic fall back to the saved value when their control is
  // missing from the DOM (defensive per house style) — mirrors the other
  // fields' read-from-control pattern rather than silently dropping them.
  const persist = () => {
    const next = normalizePinStyle({
      size: sizeInput.valueAsNumber,
      labelSize: labelSizeInput.valueAsNumber,
      labelColor: labelColorInput.value,
      labelBold: labelBoldBtn.getAttribute("aria-pressed") === "true",
      labelFont: labelFontSelect ? labelFontSelect.value : saved.labelFont,
      labelItalic: labelItalicBtn
        ? labelItalicBtn.getAttribute("aria-pressed") === "true"
        : saved.labelItalic,
    });
    savePinStyle(next);
    setPinStyle(next);
  };

  sizeInput.addEventListener("change", () => {
    sizeInput.value = String(clamp(sizeInput.valueAsNumber, 8, 96, saved.size));
    persist();
  });
  labelSizeInput.addEventListener("change", () => {
    labelSizeInput.value = String(
      clamp(labelSizeInput.valueAsNumber, 8, 48, saved.labelSize)
    );
    persist();
  });
  labelColorInput.addEventListener("input", persist);
  labelBoldBtn.addEventListener("click", () => {
    const next = labelBoldBtn.getAttribute("aria-pressed") !== "true";
    labelBoldBtn.setAttribute("aria-pressed", next ? "true" : "false");
    persist();
  });
  if (labelItalicBtn) {
    labelItalicBtn.addEventListener("click", () => {
      const next = labelItalicBtn.getAttribute("aria-pressed") !== "true";
      labelItalicBtn.setAttribute("aria-pressed", next ? "true" : "false");
      persist();
    });
  }
  if (labelFontSelect) {
    labelFontSelect.addEventListener("change", persist);
  }
}

// Reflects the persisted preference on the checkbox at boot and forwards
// every user change to onChange. Kept dumb on purpose: this function does
// not own the boolean — init() does — so re-rendering and persistence stay
// next to the rest of the app's data flow.
function initRouteToggle({ initialValue, onChange }) {
  const checkbox = document.getElementById("route-toggle");
  if (!checkbox) return;
  checkbox.checked = initialValue;
  checkbox.addEventListener("change", (event) => {
    onChange(event.target.checked);
  });
}

// PO-001 sibling of initRouteToggle. Same dumb-pipe contract: init() owns
// the boolean and the side effects; this function only mirrors the value
// onto the checkbox and forwards user changes back out.
function initHideLabelsToggle({ initialValue, onChange }) {
  const checkbox = document.getElementById("hide-labels-toggle");
  if (!checkbox) return;
  checkbox.checked = initialValue;
  checkbox.addEventListener("change", (event) => {
    onChange(event.target.checked);
  });
}

// Human-readable labels for ON_MAP_TITLE_FONTS, index-aligned with that
// array (storage.js). Kept here rather than duplicated per-row: every line
// row's font <select> is built from these two arrays zipped together. If
// the arrays ever drift in length, the fallback below just labels the
// option with its own fontstack string instead of crashing.
const ON_MAP_TITLE_FONT_LABELS = [
  "Georgia",
  "Times",
  "Helvetica",
  "Verdana",
  "Trebuchet",
  "Courier",
  "Impact",
];

// Per-line on-map title (this milestone): hydrates the overlay from
// localStorage and renders one editable ROW per line into #otm-lines, each
// with its own text input + font/bold/italic/color/size controls (mirroring
// the old single-toolbar's `.otm-format-*` classes so the look matches).
// The map-title module owns the overlay's lifecycle (DOM, drag,
// projection); this function only wires the row editor and the persistence
// callbacks together.
//
// Two write paths feed saveOnMapTitle:
//   1. Anchor-change callback — fires when the overlay's nx/ny (normalized
//      frame-relative anchor) moves (drag commit, keyboard nudge,
//      recenterX() on export-size change).
//   2. Any row edit (text/font/bold/italic/color/size) or a row add/remove —
//      rebuilds the full `lines` array from the rows in DOM order.
// Both paths call mapTitle.update() then persist whatever the module's
// internal state ends up as, so the overlay and localStorage never disagree.
function initOnMapTitle() {
  const linesContainer = document.getElementById("otm-lines");
  const addLineBtn = document.getElementById("otm-add-line");
  if (!linesContainer) return;

  const map = getMap();
  if (!map) return;

  mapTitle.init(map, {
    onAnchorChange: () => saveOnMapTitle(mapTitle.getPosition()),
  });

  const saved = loadOnMapTitle();
  // A persisted title with zero lines starts the editor with ONE empty
  // default line so the user has a row to type into; the overlay itself
  // stays hidden (defaultTitleLine()'s text is "") until they do.
  const initialLines = saved.lines.length > 0 ? saved.lines : [defaultTitleLine()];
  mapTitle.update({ nx: saved.nx, ny: saved.ny, lines: initialLines });

  // Row handles currently mounted in the DOM, in display order — rebuilt
  // wholesale on add/remove, read in place on every other edit.
  let rowHandles = [];

  const persist = () => saveOnMapTitle(mapTitle.getPosition());

  const clampSize = (n) =>
    Number.isFinite(n) ? Math.max(10, Math.min(80, Math.round(n))) : 20;

  // Rebuilds the full `lines` array from the rows in DOM order and pushes
  // it through the overlay + persistence. Called on every in-place row edit
  // (text/font/bold/italic/color/size) — it deliberately does NOT touch the
  // DOM itself, so a keystroke never steals focus from the input mid-type.
  function rebuildFromRows() {
    const lines = rowHandles.map((h) => ({
      text: h.textInput.value,
      font: h.fontSelect.value,
      bold: h.boldBtn.getAttribute("aria-pressed") === "true",
      italic: h.italicBtn.getAttribute("aria-pressed") === "true",
      color: h.colorInput.value,
      size: clampSize(Number(h.sizeInput.value)),
    }));
    mapTitle.update({ lines });
    persist();
  }

  // Full teardown/rebuild of the row DOM from the overlay's current lines.
  // Used only on structural changes (add/remove a line) — in-place edits
  // go through rebuildFromRows() above instead, so typing never re-renders
  // the row out from under the cursor.
  function renderRows() {
    linesContainer.innerHTML = "";
    rowHandles = mapTitle.getPosition().lines.map((line) => {
      const handle = buildLineRow(line);
      wireRow(handle);
      linesContainer.appendChild(handle.row);
      return handle;
    });
  }

  function wireRow(handle) {
    handle.textInput.addEventListener("input", rebuildFromRows);
    handle.fontSelect.addEventListener("change", rebuildFromRows);
    handle.boldBtn.addEventListener("click", () => {
      const next = handle.boldBtn.getAttribute("aria-pressed") !== "true";
      handle.boldBtn.setAttribute("aria-pressed", next ? "true" : "false");
      rebuildFromRows();
    });
    handle.italicBtn.addEventListener("click", () => {
      const next = handle.italicBtn.getAttribute("aria-pressed") !== "true";
      handle.italicBtn.setAttribute("aria-pressed", next ? "true" : "false");
      rebuildFromRows();
    });
    handle.colorInput.addEventListener("input", rebuildFromRows);
    handle.sizeInput.addEventListener("change", () => {
      // Clamp here (not just in storage) so the input box and the
      // persisted value agree immediately. Bounds match the
      // ON_MAP_TITLE_SIZE_MIN/MAX in storage.js.
      handle.sizeInput.value = String(clampSize(Number(handle.sizeInput.value)));
      rebuildFromRows();
    });
    handle.removeBtn.addEventListener("click", () => {
      const idx = rowHandles.indexOf(handle);
      if (idx === -1) return;
      const lines = mapTitle.getPosition().lines.filter((_, i) => i !== idx);
      mapTitle.update({ lines });
      persist();
      renderRows();
    });
  }

  if (addLineBtn) {
    addLineBtn.addEventListener("click", () => {
      const lines = [...mapTitle.getPosition().lines, defaultTitleLine()];
      mapTitle.update({ lines });
      persist();
      renderRows();
    });
  }

  renderRows();

  // FBL-013: expose the LIVE overlay position so the export reads the same
  // in-memory title state it renders — not the persisted copy, which can lag
  // behind after a "kept in memory only" save failure.
  return { getLivePosition: () => mapTitle.getPosition() };
}

// Builds one line row's DOM (not yet wired or mounted) from a title line.
// Reuses the `.otm-format-*` classes the old single toolbar used so the
// per-row controls read as the same design family; `.otm-line-row` /
// `.otm-line-text` / `.otm-line-remove` are the new per-row wrapper classes
// (see css/styles.css). Returns the row element plus handles to every
// control so the caller can wire listeners and read values back out.
function buildLineRow(line) {
  const row = document.createElement("div");
  row.className = "otm-line-row";

  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.className = "otm-line-text";
  textInput.placeholder = "Line text";
  textInput.autocomplete = "off";
  textInput.spellcheck = false;
  textInput.value = line.text;

  const fontSelect = document.createElement("select");
  fontSelect.className = "otm-format-select";
  fontSelect.setAttribute("aria-label", "Font family");
  fontSelect.title = "Font family";
  ON_MAP_TITLE_FONTS.forEach((font, i) => {
    const opt = document.createElement("option");
    opt.value = font;
    opt.textContent = ON_MAP_TITLE_FONT_LABELS[i] || font;
    fontSelect.appendChild(opt);
  });
  fontSelect.value = line.font;

  const boldBtn = document.createElement("button");
  boldBtn.type = "button";
  boldBtn.className = "otm-format-toggle";
  boldBtn.setAttribute("aria-label", "Bold");
  boldBtn.title = "Bold";
  boldBtn.setAttribute("aria-pressed", line.bold ? "true" : "false");
  const boldGlyph = document.createElement("span");
  boldGlyph.className = "otm-format-toggle__glyph otm-format-toggle__glyph--bold";
  boldGlyph.textContent = "B";
  boldBtn.appendChild(boldGlyph);

  const italicBtn = document.createElement("button");
  italicBtn.type = "button";
  italicBtn.className = "otm-format-toggle";
  italicBtn.setAttribute("aria-label", "Italic");
  italicBtn.title = "Italic";
  italicBtn.setAttribute("aria-pressed", line.italic ? "true" : "false");
  const italicGlyph = document.createElement("span");
  italicGlyph.className = "otm-format-toggle__glyph otm-format-toggle__glyph--italic";
  italicGlyph.textContent = "I";
  italicBtn.appendChild(italicGlyph);

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "otm-format-color";
  colorInput.setAttribute("aria-label", "Text color");
  colorInput.title = "Text color";
  colorInput.value = line.color;

  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.min = "10";
  sizeInput.max = "80";
  sizeInput.step = "1";
  sizeInput.className = "otm-format-size";
  sizeInput.setAttribute("aria-label", "Font size in pixels");
  sizeInput.title = "Size (px)";
  sizeInput.value = String(line.size);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "otm-line-remove";
  removeBtn.setAttribute("aria-label", "Remove line");
  removeBtn.title = "Remove line";
  removeBtn.textContent = "✕";

  row.append(textInput, fontSelect, boldBtn, italicBtn, colorInput, sizeInput, removeBtn);

  return { row, textInput, fontSelect, boldBtn, italicBtn, colorInput, sizeInput, removeBtn };
}

// Disabling the button across the await prevents double-clicks during the
// tile-wait window (where the user has no other feedback that anything is
// happening). The finally branch restores it whether export succeeded,
// failed silently into showError(), or threw past the catch.
//
// HARDEN-003: the inline #export-status span gets "Rendering…" only after
// a 200 ms delay — the Nielsen "feels-instant" threshold. Fast-path
// exports (current view, no on-map title) typically resolve before the
// timer fires, so no label flash. The timer handle is cleared in the
// finally branch whether the export resolved before or after the threshold.
function initExportButton({ getFrame, getOnMapTitle, getBottomFade } = {}) {
  const button = document.getElementById("export-png");
  const status = document.getElementById("export-status");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    const statusTimer = window.setTimeout(() => {
      if (status) status.textContent = "Rendering…";
    }, 200);
    try {
      // Read the live overlay state at CLICK time (not init time) and hand it
      // to the export, which prefers it over persisted storage (FBL-013).
      await exportMapAsPng(getMap(), {
        frame: getFrame ? getFrame() : undefined,
        onMapTitle: getOnMapTitle ? getOnMapTitle() : undefined,
        bottomFade: getBottomFade ? getBottomFade() : undefined,
      });
    } finally {
      window.clearTimeout(statusTimer);
      if (status) status.textContent = "";
      button.disabled = false;
    }
  });
}

// Wires the side-panel Export JSON / Import JSON buttons (HARDEN-001).
// Import uses an ad-hoc <input type="file"> that lives only for the picker
// roundtrip — keeps the input element out of the DOM tree at rest, where it
// would otherwise be a focus-trap snare and a tab-order surprise. The
// picker's value never persists, so a user picking the same file twice
// re-fires `change` cleanly without manual reset.
function initBackupControls() {
  const exportBtn = document.getElementById("export-json");
  const importBtn = document.getElementById("import-json");
  if (!exportBtn || !importBtn) return;

  exportBtn.addEventListener("click", () => {
    exportToJson();
  });

  importBtn.addEventListener("click", () => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "application/json,.json";
    picker.addEventListener("change", () => {
      const file = picker.files && picker.files[0];
      if (file) importFromJson(file);
    });
    picker.click();
  });
}

// PO-004: sibling of initBackupControls's import wiring, same ad-hoc
// <input type="file"> pattern. The button is disabled for the duration of
// importFromFile() so a double-click can't start two overlapping imports
// (each with its own confirm dialog and progress text) — everything else
// in the UI (search, pin list, other buttons) stays usable throughout,
// since only this one button's disabled state is touched.
function initImportFromFileControl() {
  const importFileBtn = document.getElementById("import-file");
  if (!importFileBtn) return;

  importFileBtn.addEventListener("click", () => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".csv,.json,text/csv,application/json";
    picker.addEventListener("change", async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      importFileBtn.disabled = true;
      try {
        await importFromFile(file);
      } finally {
        importFileBtn.disabled = false;
      }
    });
    picker.click();
  });
}

document.addEventListener("DOMContentLoaded", init);
