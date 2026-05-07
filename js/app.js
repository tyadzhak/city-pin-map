// App bootstrap. Wires modules together once the DOM is ready.
// Other modules reach the map via map.js → getMap(), so app.js doesn't
// need to re-export it.
import { initMap, renderPins } from "./map.js";
import * as pinStore from "./pins.js";
import { attachStorage } from "./storage.js";
import { exportMapPng } from "./export.js";
import { initSearch } from "./search.js";
import { initPinList } from "./pin-list.js";

function init() {
  initMap("map");
  attachStorage(pinStore);

  // Render once with hydrated state, then keep markers in sync with every
  // future change. Subscribing AFTER attachStorage matches the order the
  // spec describes; the manual call below covers the pins loaded during
  // hydration (which fired notify() before we were listening).
  pinStore.subscribe(renderPins);
  renderPins(pinStore.listPins());

  // Side-panel pin list. Subscribes internally and runs an initial render
  // to backfill the hydration notify() that fired during attachStorage.
  initPinList();

  // Search wires the header input to the geocoder + pin store. It must run
  // after the DOM is ready (we're already inside DOMContentLoaded) and
  // doesn't depend on the map directly — pin additions flow through the
  // store and reach the map via the subscription above.
  initSearch();
}

document.addEventListener("DOMContentLoaded", init);
