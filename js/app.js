// App bootstrap. Wires modules together once the DOM is ready.
// Other modules reach the map via map.js → getMap(), so app.js doesn't
// need to re-export it.
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

  initMap("map", initialStyleId);
  initMapStyleSelector(initialStyleId);
  attachStorage(pinStore);
  // Hydrate the group store BEFORE initGroupPanel — same rationale as
  // attachStorage above: the panel's first render must reflect persisted
  // groups, and reversing the order would write `[]` straight back to disk.
  attachGroupStorage(groupStore);

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

  initExportOptions();
  initExportFormatSelector();
  initExportButton();
  initBackupControls();
  initSettingsPanel();
}

// Hydrates the title + subtitle inputs from localStorage and persists every
// keystroke. We read both inputs on every event so the saved object stays
// consistent if the user is mid-edit on one field while the other is
// already filled.
function initExportOptions() {
  const titleInput = document.getElementById("export-title");
  const subtitleInput = document.getElementById("export-subtitle");
  if (!titleInput || !subtitleInput) return;

  const saved = loadExportText();
  titleInput.value = saved.title;
  subtitleInput.value = saved.subtitle;

  const persist = () =>
    saveExportText({
      title: titleInput.value,
      subtitle: subtitleInput.value,
    });

  titleInput.addEventListener("input", persist);
  subtitleInput.addEventListener("input", persist);
}

// Hydrates the format selector from localStorage and persists every
// change. The export pipeline reads the current value back out of the
// DOM at click time (mirrors how export-title / export-subtitle are
// read), so this function only owns persistence — it does not need to
// notify any other module when the value flips.
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

// Build the <option> list from MAP_STYLES so adding a style in js/map.js
// flows through without an HTML edit. Initial selected value matches the
// style initMap just painted, keeping the dropdown and the visible tiles
// in sync on first render.
function initMapStyleSelector(initialStyleId) {
  const select = document.getElementById("map-style-select");
  if (!select) return;

  for (const style of MAP_STYLES) {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.label;
    select.appendChild(option);
  }
  select.value = initialStyleId;

  select.addEventListener("change", (event) => {
    setMapStyle(event.target.value);
  });
}

// Disabling the button across the await prevents double-clicks during the
// tile-wait window (where the user has no other feedback that anything is
// happening). The finally branch restores it whether export succeeded,
// failed silently into showError(), or threw past the catch.
//
// HARDEN-003: the inline #export-status span gets "Rendering…" only after
// a 200 ms delay — the Nielsen "feels-instant" threshold. Fast-path
// exports (current view, no title/subtitle) typically resolve before the
// timer fires, so no label flash. The timer handle is cleared in the
// finally branch whether the export resolved before or after the threshold.
function initExportButton() {
  const button = document.getElementById("export-png");
  const status = document.getElementById("export-status");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    const statusTimer = window.setTimeout(() => {
      if (status) status.textContent = "Rendering…";
    }, 200);
    try {
      await exportMapAsPng(getMap());
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

document.addEventListener("DOMContentLoaded", init);
