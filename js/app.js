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
  normalizeFrame,
  loadHideLabels,
  saveHideLabels,
  loadOnMapTitle,
  saveOnMapTitle,
  showError,
} from "./storage.js";
import { exportMapAsPng } from "./export.js";
import { exportToJson, importFromJson } from "./backup.js";
import { importFromFile } from "./import-foreign.js";
import { initSearch } from "./search.js";
import { initPinList } from "./pin-list.js";
import { initGroupPanel } from "./group-panel.js";
import { initSettingsPanel, openSettingsScrolledTo } from "./settings-panel.js";
import { initStylePicker } from "./style-picker.js";
import * as mapTitle from "./map-title.js";
import * as mapFrame from "./map-frame.js";

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

  initExportFormatSelector();
  // Capture the live-state accessors so the export button consumes the same
  // in-memory frame/title the on-map overlays render from (FBL-013), rather
  // than re-reading localStorage inside the export pipeline. Either handle is
  // undefined if its init bailed (missing DOM / no map); the button then
  // passes nothing and export.js falls back to the persisted value.
  const exportFrameHandle = initExportFrameOptions();
  const onMapTitleHandle = initOnMapTitle();
  initExportButton({
    getFrame: exportFrameHandle?.getLiveFrame,
    getOnMapTitle: onMapTitleHandle?.getLivePosition,
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
function initExportFormatSelector() {
  const select = document.getElementById("export-format");
  if (!select) return;

  const saved = loadExportFormat();
  const isKnown = Array.from(select.options).some((o) => o.value === saved);
  if (isKnown) select.value = saved;

  select.addEventListener("change", (event) => {
    saveExportFormat(event.target.value);
  });
}

// Hydrates the seven Frame inputs (PO-007, extended with padding/margin/
// radius) from localStorage, persists every change, and drives the live
// WYSIWYG overlay (js/map-frame.js) so the frame is previewed on the map
// itself instead of only appearing after export. The wrapper's
// data-frame-enabled attribute still drives CSS visibility for the
// dependent controls — see .export-frame-controls in css/styles.css. The
// export pipeline reads each input back out of the DOM at click time, so
// this function's persistence half doesn't need to notify anything else.
//
// Persistence reads ALL SEVEN inputs on every change so saveExportFrame
// always receives a complete object — required because normalizeFrame
// fills missing fields from the static defaults, not from prior state.
function initExportFrameOptions() {
  const enabled = document.getElementById("export-frame-enabled");
  const thickness = document.getElementById("export-frame-thickness");
  const color = document.getElementById("export-frame-color");
  const padding = document.getElementById("export-frame-padding");
  const margin = document.getElementById("export-frame-margin");
  const radius = document.getElementById("export-frame-radius");
  const shadow = document.getElementById("export-frame-shadow");
  const wrapper = document.getElementById("export-frame-controls");
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
    return;

  // The live overlay needs a map to attach to; on a boot path where initMap
  // failed outright there's nothing to preview, so just skip that half and
  // still let the (non-visual) persistence wiring below work normally.
  const map = getMap();
  if (map) mapFrame.init(map);

  // Builds the full 7-field FRAME OBJECT straight from the DOM — the single
  // read path both persist() and the live-overlay update share, so they can
  // never disagree about what's currently on screen.
  const readFrame = () => ({
    enabled: enabled.checked,
    thickness: thickness.valueAsNumber,
    color: color.value,
    shadow: shadow.checked,
    padding: padding.valueAsNumber,
    margin: margin.valueAsNumber,
    radius: radius.valueAsNumber,
  });

  const saved = loadExportFrame();
  enabled.checked = saved.enabled;
  thickness.value = String(saved.thickness);
  color.value = saved.color;
  padding.value = String(saved.padding);
  margin.value = String(saved.margin);
  radius.value = String(saved.radius);
  shadow.checked = saved.shadow;
  wrapper.dataset.frameEnabled = saved.enabled ? "true" : "false";

  // Reflect the persisted state on the overlay at boot, same as
  // mapTitle.update(saved) in initOnMapTitle — otherwise the live preview
  // would stay blank until the user next touches a frame control.
  if (map) mapFrame.update(saved);

  const persist = () => {
    const next = readFrame();
    saveExportFrame(next);
    if (map) mapFrame.update(next);
  };

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

  // FBL-013: expose a LIVE frame accessor so the export button reads the same
  // in-memory state the overlay renders from — normalized through the very
  // same normalizeFrame() that loadExportFrame() applies — instead of
  // re-reading (possibly stale) localStorage at click time. readFrame() is
  // the same DOM read persist()/mapFrame.update() use, so the export and the
  // preview can never disagree, even after a "kept in memory only" save.
  return { getLiveFrame: () => normalizeFrame(readFrame()) };
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

// PO-008/009: hydrates the on-map title input + formatting toolbar +
// overlay from localStorage and keeps all three in sync. The map-title
// module owns the overlay's lifecycle (DOM, drag, projection); this
// function only wires the input box, the toolbar controls, and the
// persistence callbacks together.
//
// Three write paths feed saveOnMapTitle:
//   1. Anchor-change callback — fires when the overlay's lon/lat moves
//      (drag commit, keyboard nudge, fill-from-center on first reveal).
//   2. Text input event — fires on every keystroke.
//   3. Toolbar control change — font / bold / italic / color / size.
// Each path calls mapTitle.update() with only the changing field; the
// module's merge-over-existing semantics keep the rest intact, then we
// persist whatever the module's internal state ends up as.
function initOnMapTitle() {
  const input = document.getElementById("export-on-map-title");
  if (!input) return;

  const fontSelect = document.getElementById("otm-font");
  const boldBtn = document.getElementById("otm-bold");
  const italicBtn = document.getElementById("otm-italic");
  const colorInput = document.getElementById("otm-color");
  const sizeInput = document.getElementById("otm-size");

  const map = getMap();
  if (!map) return;

  mapTitle.init(map, {
    onAnchorChange: () => saveOnMapTitle(mapTitle.getPosition()),
  });

  const saved = loadOnMapTitle();
  input.value = saved.text;
  if (fontSelect) fontSelect.value = saved.font;
  if (boldBtn) boldBtn.setAttribute("aria-pressed", saved.bold ? "true" : "false");
  if (italicBtn)
    italicBtn.setAttribute("aria-pressed", saved.italic ? "true" : "false");
  if (colorInput) colorInput.value = saved.color;
  if (sizeInput) sizeInput.value = String(saved.size);

  // Hand the persisted state to the overlay. If text is set, the module
  // shows the overlay (seeding lon/lat from the map center if those are
  // null); if text is empty, the overlay stays hidden but lon/lat +
  // formatting are remembered so re-typing brings the title back at the
  // same place with the same look.
  mapTitle.update(saved);

  // Helper that applies a partial diff and persists. The module merges
  // over current state, so passing only the changed field is sufficient.
  const apply = (partial) => {
    mapTitle.update(partial);
    saveOnMapTitle(mapTitle.getPosition());
  };

  input.addEventListener("input", () => apply({ text: input.value }));

  if (fontSelect) {
    fontSelect.addEventListener("change", () =>
      apply({ font: fontSelect.value })
    );
  }
  if (boldBtn) {
    boldBtn.addEventListener("click", () => {
      const next = boldBtn.getAttribute("aria-pressed") !== "true";
      boldBtn.setAttribute("aria-pressed", next ? "true" : "false");
      apply({ bold: next });
    });
  }
  if (italicBtn) {
    italicBtn.addEventListener("click", () => {
      const next = italicBtn.getAttribute("aria-pressed") !== "true";
      italicBtn.setAttribute("aria-pressed", next ? "true" : "false");
      apply({ italic: next });
    });
  }
  if (colorInput) {
    colorInput.addEventListener("input", () => apply({ color: colorInput.value }));
  }
  if (sizeInput) {
    // `change` fires on blur/Enter/spinner; using it (not `input`) keeps
    // the persist + reflow burst out of every digit-typed keystroke.
    sizeInput.addEventListener("change", () => {
      const parsed = Number(sizeInput.value);
      if (!Number.isFinite(parsed)) return;
      // Clamp here (not just in storage) so the live overlay, the input
      // box, and the persisted value all agree. Bounds match the
      // ON_MAP_TITLE_SIZE_MIN/MAX in storage.js.
      const clamped = Math.max(10, Math.min(80, Math.round(parsed)));
      apply({ size: clamped });
      sizeInput.value = String(clamped);
    });
  }

  // FBL-013: expose the LIVE overlay position so the export reads the same
  // in-memory title state it renders — not the persisted copy, which can lag
  // behind after a "kept in memory only" save failure.
  return { getLivePosition: () => mapTitle.getPosition() };
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
function initExportButton({ getFrame, getOnMapTitle } = {}) {
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
