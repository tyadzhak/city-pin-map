// UXR-012: first-run empty-state card over the map. With zero pins the only
// hint used to be small grey text in a hidden tab, so a new user faced a blank
// map with no cue. The card is a DOM overlay inside .app-map — a sibling of
// #map, so export (which captures #map's canvas) can never include it.
import { activateTab } from "./side-tabs.js";

export function initEmptyState({ pinStore }) {
  const region = document.querySelector(".app-map");
  if (!region) return;

  const card = document.createElement("div");
  card.className = "empty-state";
  card.id = "map-empty-state";
  card.innerHTML =
    '<h2 class="empty-state__title">Start by searching for a city</h2>' +
    '<p class="empty-state__text">Type a city name in the search box, pick a result, and it is pinned on the map.</p>' +
    '<button type="button" class="empty-state__button">Search for a city</button>';
  region.appendChild(card);

  card.querySelector("button").addEventListener("click", () => {
    const input = document.getElementById("search-input");
    if (input) input.focus();
  });

  const sync = () => {
    card.hidden = pinStore.listPins().length > 0;
  };
  // Covers add, delete-all, New map (replaceAll([])) and snapshot/backup loads.
  pinStore.subscribe(sync);
  sync();

  // Open the Pins tab on an empty boot. This goes through the normal tab
  // activation, so it also overwrites the saved tab preference; that is
  // harmless (a user with no pins has no meaningful tab preference) and
  // avoids a second non-persisting code path.
  if (pinStore.listPins().length === 0) activateTab("pins");
}
