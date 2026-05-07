// App bootstrap. Imports module stubs so they're wired up; CORE-001 only logs.
// Future tasks will call into these modules from init().
import { initMap } from "./map.js";
import { geocode } from "./geocode.js";
import { createPinStore } from "./pins.js";
import { loadPins, savePins } from "./storage.js";
import { exportMapPng } from "./export.js";

function init() {
  console.log("[city-pin-map] app started");
}

document.addEventListener("DOMContentLoaded", init);
