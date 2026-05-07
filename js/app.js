// App bootstrap. Wires modules together once the DOM is ready.
// Other modules reach the map via map.js → getMap(), so app.js doesn't
// need to re-export it.
import { initMap } from "./map.js";
import { geocode } from "./geocode.js";
import "./pins.js";
import { loadPins, savePins } from "./storage.js";
import { exportMapPng } from "./export.js";

function init() {
  initMap("map");
}

document.addEventListener("DOMContentLoaded", init);
