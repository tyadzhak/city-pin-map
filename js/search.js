// CORE-007: Debounced city search that adds pins to the store on selection.
//
// Two cooperating layers of throttling:
//   1. UI-side debounce (this file) — wait for the user to stop typing before
//      issuing a fetch. Without this, fast typing would queue many requests
//      behind the geocoder's gate and feel laggy.
//   2. Server-side rate limit (geocode.js) — ≥ 1 second between outbound
//      fetches, regardless of how the UI calls in. Required by Nominatim's
//      usage policy (CLAUDE.md → "Hard rules").
//
// The UI never touches Leaflet directly: it only calls addPin(), and the map
// re-renders via the pin store's pub/sub (see app.js bootstrap).

import { searchCities } from "./geocode.js";
import { addPin, DEFAULT_PIN_COLOR } from "./pins.js";
import { showError } from "./storage.js";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LEN = 2;

let inputEl = null;
let listEl = null;
let debounceTimer = null;
// AbortController for the in-flight searchCities() call. Replacing this
// reference is how runQuery() detects that a newer query has superseded it.
let abortController = null;
// Cached most-recent results so Enter-selects-first works without re-querying.
let currentResults = [];

export function initSearch() {
  inputEl = document.querySelector("#search-input");
  listEl = document.querySelector("#search-results");
  if (!inputEl || !listEl) {
    console.warn("search UI missing #search-input or #search-results");
    return;
  }

  inputEl.addEventListener("input", handleInput);
  inputEl.addEventListener("keydown", handleKeydown);
  // Click handling is delegated from the <ul> so we don't re-bind on every
  // render. The dataset on each <li> carries the lat/lon/name.
  listEl.addEventListener("click", handleListClick);
}

// Handle every keystroke in the search input. Two design choices baked in:
//   - Eager abort: cancel any in-flight fetch on every keystroke so a late
//     response from an earlier query can't overwrite the results of a newer
//     one. Costs a few extra AbortErrors; pays for itself on slow networks.
//   - Stale results stay visible during the 350ms debounce window, rather
//     than flickering empty on every keystroke. The next runQuery replaces
//     them atomically.
function handleInput() {
  const query = inputEl.value.trim();

  abortController?.abort();
  if (debounceTimer !== null) clearTimeout(debounceTimer);

  if (query.length < MIN_QUERY_LEN) {
    clearDropdown();
    return;
  }

  debounceTimer = setTimeout(() => runQuery(query), DEBOUNCE_MS);
}

/**
 * Run a geocoder query and render the results. Guards against stale
 * resolutions: if a newer query starts before this one resolves, our
 * abortController reference will have been replaced and we drop the result.
 */
async function runQuery(query) {
  abortController?.abort();
  abortController = new AbortController();
  const myController = abortController;

  try {
    const results = await searchCities(query, { signal: myController.signal });
    if (myController !== abortController) return;
    currentResults = results;
    renderResults(results);
  } catch (err) {
    // Aborted by us when the user kept typing — not a user-visible error.
    if (err?.name === "AbortError") return;
    if (myController !== abortController) return;
    currentResults = [];
    const message = err?.message ?? "Search failed.";
    renderError(message);
    showError(message);
  }
}

function renderResults(results) {
  listEl.replaceChildren();
  if (results.length === 0) {
    const li = document.createElement("li");
    li.className = "search__row search__row--empty";
    li.textContent = "No matches.";
    listEl.append(li);
  } else {
    for (const [idx, r] of results.entries()) {
      const li = document.createElement("li");
      li.className = "search__row";
      li.setAttribute("role", "option");
      // Index into currentResults so the click handler can read the full
      // result object — including the `address` block — without round-
      // tripping through dataset attributes (which only carry strings).
      li.dataset.idx = String(idx);
      li.textContent = r.displayName;
      listEl.append(li);
    }
  }
  listEl.hidden = false;
}

function renderError(message) {
  listEl.replaceChildren();
  const li = document.createElement("li");
  li.className = "search__row search__row--error";
  li.textContent = message;
  listEl.append(li);
  listEl.hidden = false;
}

function clearDropdown() {
  listEl.replaceChildren();
  listEl.hidden = true;
  currentResults = [];
}

/**
 * Build a short, readable default name for a newly-pinned city.
 *
 * Priority:
 *   1. "${city}, ${country}" when Nominatim's address block supplies both,
 *      where `city` is the first non-empty of:
 *        city → town → village → municipality → county
 *   2. Otherwise, the segment before the first comma of `displayName`,
 *      followed by ", ${country}" when address.country is present.
 *   3. Otherwise, `displayName` unchanged (never returns empty).
 *
 * @param {{ displayName: string, address: object | null }} result
 * @returns {string}
 */
function shortName(result) {
  const addr = result.address ?? {};
  const country = addr.country;
  const city =
    addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.county;

  if (city && country) return `${city}, ${country}`;

  const head = result.displayName?.split(",")[0]?.trim();
  if (head && country) return `${head}, ${country}`;
  if (head) return head;

  return result.displayName;
}

function selectResult(result) {
  addPin({
    name: shortName(result),
    lat: result.lat,
    lon: result.lon,
    color: DEFAULT_PIN_COLOR,
  });
  inputEl.value = "";
  clearDropdown();
}

function handleListClick(event) {
  const row = event.target.closest(".search__row");
  if (!row || row.dataset.idx === undefined) return;
  const result = currentResults[Number(row.dataset.idx)];
  if (!result) return;
  selectResult(result);
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    clearDropdown();
    return;
  }
  if (event.key === "Enter" && !listEl.hidden && currentResults.length > 0) {
    event.preventDefault();
    selectResult(currentResults[0]);
  }
}

// Exposed for the (future) test harness; not used in production code.
export const __internals = { DEFAULT_PIN_COLOR, DEBOUNCE_MS, MIN_QUERY_LEN };
