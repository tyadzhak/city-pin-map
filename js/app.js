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
import {
  attachStorage,
  loadMapStyle,
  loadRouteVisible,
  saveRouteVisible,
} from "./storage.js";
import { exportMapAsPng } from "./export.js";
import { initSearch } from "./search.js";
import { initPinList } from "./pin-list.js";

function init() {
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
  renderPins(pinStore.listPins());
  renderRoute(pinStore.listPins(), { visible: routeVisible });

  // Side-panel pin list. Subscribes internally and runs an initial render
  // to backfill the hydration notify() that fired during attachStorage.
  initPinList();

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

  initExportButton();
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
function initExportButton() {
  const button = document.getElementById("export-png");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await exportMapAsPng(getMap());
    } finally {
      button.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
