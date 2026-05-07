// App bootstrap. Wires modules together once the DOM is ready.
// Other modules reach the map via map.js → getMap(), so app.js doesn't
// need to re-export it.
import { initMap, renderPins } from "./map.js";
import { geocode } from "./geocode.js";
import * as pinStore from "./pins.js";
import { attachStorage } from "./storage.js";
import { exportMapPng } from "./export.js";

function init() {
  initMap("map");
  attachStorage(pinStore);

  // Render once with hydrated state, then keep markers in sync with every
  // future change. Subscribing AFTER attachStorage matches the order the
  // spec describes; the manual call below covers the pins loaded during
  // hydration (which fired notify() before we were listening).
  pinStore.subscribe(renderPins);
  renderPins(pinStore.listPins());
}

document.addEventListener("DOMContentLoaded", init);
