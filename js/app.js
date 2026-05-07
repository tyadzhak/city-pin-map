// App bootstrap. Wires modules together once the DOM is ready.
// Other modules reach the map via map.js → getMap(), so app.js doesn't
// need to re-export it.
import { initMap, renderPins, getMap } from "./map.js";
import * as pinStore from "./pins.js";
import { attachStorage } from "./storage.js";
import { exportMapAsPng } from "./export.js";
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

  initExportButton();
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
