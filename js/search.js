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
import { addPin, listPins } from "./pins.js";
import { loadDefaultPin } from "./storage.js";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LEN = 2;

// UXR-002: optional hook fired with the created pin so app.js can reveal it on
// the map. Injected (not imported) so this module stays node-testable with no
// map or DOM-heavy dependencies.
let onPinAdded = null;
export function setOnPinAdded(fn) {
  onPinAdded = typeof fn === "function" ? fn : null;
}

let inputEl = null;
let listEl = null;
let debounceTimer = null;
// AbortController for the in-flight searchCities() call. Replacing this
// reference is how runQuery() detects that a newer query has superseded it.
let abortController = null;
// Cached most-recent results so Enter-selects-first works without re-querying.
let currentResults = [];
// UXR-013: keyboard-highlighted option (index into currentResults), -1 = none.
let activeIdx = -1;
// UXR-013: Enter pressed before results arrived — pick the first one on arrival.
let pendingPick = false;
// True while a geocoder request is in flight (the debounce timer is separate).
let searching = false;
let outsideListenerBound = false;

const PINNED_RADIUS_KM = 2;
const DEDUPE_DEG = 0.01;

/**
 * Pure: drop visually identical Nominatim hits. Two results are duplicates when
 * their displayName matches (case/whitespace-insensitive), or when their short
 * name matches and they sit within ~0.01 degrees of each other. First wins.
 * @param {Array<{displayName: string, lat: number, lon: number, address?: object|null}>} results
 */
export function dedupeResults(results) {
  const kept = [];
  for (const r of results) {
    const full = normName(r.displayName);
    const short = normName(shortName(r));
    const dup = kept.some((k) => {
      if (normName(k.displayName) === full) return true;
      return (
        normName(shortName(k)) === short &&
        Math.abs(k.lat - r.lat) <= DEDUPE_DEG &&
        Math.abs(k.lon - r.lon) <= DEDUPE_DEG
      );
    });
    if (!dup) kept.push(r);
  }
  return kept;
}

function normName(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Pure: is this result already on the map? Same short name as an existing pin
 * (case-insensitive), or within ~2 km of one.
 */
export function isAlreadyPinned(result, pins) {
  const name = normName(shortName(result));
  return pins.some((p) => {
    if (name && normName(p.name) === name) return true;
    if (![p.lat, p.lon, result.lat, result.lon].every(Number.isFinite)) return false;
    return distanceKm(p.lat, p.lon, result.lat, result.lon) <= PINNED_RADIUS_KM;
  });
}

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
  listEl.addEventListener("mouseover", handleListHover);
  // Document-level so a click anywhere outside the search closes the dropdown.
  // Result clicks land inside .search, so they are unaffected.
  if (!outsideListenerBound && typeof document.addEventListener === "function") {
    outsideListenerBound = true;
    document.addEventListener("pointerdown", handleOutsidePointer);
  }
}

function handleOutsidePointer(event) {
  if (!listEl || listEl.hidden) return;
  if (event.target?.closest?.(".search")) return;
  cancelPending();
  clearDropdown();
}

// Stop any queued/in-flight lookup so it cannot reopen the list after a dismiss.
function cancelPending() {
  abortController?.abort();
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = null;
  searching = false;
  pendingPick = false;
}

// Handle every keystroke in the search input. Two design choices baked in:
//   - Eager abort: cancel any in-flight fetch on every keystroke so a late
//     response from an earlier query can't overwrite the results of a newer
//     one. Costs a few extra AbortErrors; pays for itself on slow networks.
//   - A "Searching…" row replaces the old results immediately (UXR-013), so
//     stale hits are never visible, and Enter can never pick one of them.
function handleInput() {
  const query = inputEl.value.trim();

  cancelPending();

  if (query.length < MIN_QUERY_LEN) {
    clearDropdown();
    return;
  }

  currentResults = [];
  activeIdx = -1;
  renderSearching();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runQuery(query);
  }, DEBOUNCE_MS);
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
  searching = true;

  try {
    const results = dedupeResults(
      await searchCities(query, { signal: myController.signal })
    );
    if (myController !== abortController) return;
    searching = false;
    currentResults = results;
    renderResults(results);
    const pick = pendingPick;
    pendingPick = false;
    if (pick && results.length > 0) selectResult(results[0]);
  } catch (err) {
    // Aborted by us when the user kept typing — not a user-visible error.
    if (err?.name === "AbortError") return;
    if (myController !== abortController) return;
    searching = false;
    pendingPick = false;
    currentResults = [];
    const message = err?.message ?? "Search failed.";
    // Inline dropdown row only: a second toast just duplicated the message.
    renderError(message);
  }
}

function renderSearching() {
  listEl.replaceChildren();
  const li = document.createElement("li");
  li.className = "search__row search__row--empty search__row--searching";
  li.textContent = "Searching…";
  listEl.append(li);
  listEl.hidden = false;
  inputEl.removeAttribute("aria-activedescendant");
}

function renderResults(results) {
  listEl.replaceChildren();
  const pins = listPins();
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
      li.id = `search-opt-${idx}`;
      li.textContent = r.displayName;
      if (isAlreadyPinned(r, pins)) {
        // Hint only: picking it still adds another pin.
        const badge = document.createElement("span");
        badge.className = "search__badge";
        badge.textContent = "already pinned";
        li.append(badge);
      }
      listEl.append(li);
    }
  }
  listEl.hidden = false;
  setActive(results.length > 0 ? 0 : -1);
}

// Highlight option idx (-1 clears). aria-activedescendant keeps focus on the
// input while screen readers follow the highlight.
function setActive(idx) {
  activeIdx = idx;
  for (const row of listEl.children) {
    const on = row.dataset?.idx !== undefined && Number(row.dataset.idx) === idx;
    if (on) row.classList.add("search__row--active");
    else row.classList.remove("search__row--active");
    if (on) {
      row.setAttribute("aria-selected", "true");
      row.scrollIntoView?.({ block: "nearest" });
    } else if (row.dataset?.idx !== undefined) {
      row.setAttribute("aria-selected", "false");
    }
  }
  if (idx >= 0) inputEl.setAttribute("aria-activedescendant", `search-opt-${idx}`);
  else inputEl.removeAttribute("aria-activedescendant");
}

function handleListHover(event) {
  const row = event.target.closest?.(".search__row");
  if (!row || row.dataset.idx === undefined) return;
  const idx = Number(row.dataset.idx);
  if (idx !== activeIdx) setActive(idx);
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
  activeIdx = -1;
  pendingPick = false;
  inputEl?.removeAttribute("aria-activedescendant");
}

/**
 * Build a short, readable default name for a newly-pinned city.
 *
 * City-only (batch item MISC: dropped the ", country" suffix HARDEN-004
 * originally added — the country was more clutter than signal once the
 * side panel already lists every pin, and the user can always rename).
 *
 * Priority:
 *   1. The first non-empty of Nominatim's address block:
 *        city → town → village → municipality → county
 *   2. Otherwise, the segment before the first comma of `displayName`.
 *   3. Otherwise, `displayName` unchanged (never returns empty).
 *
 * @param {{ displayName: string, address: object | null }} result
 * @returns {string}
 */
function shortName(result) {
  const addr = result.address ?? {};
  const city =
    addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.county;

  if (city) return city;

  const head = result.displayName?.split(",")[0]?.trim();
  if (head) return head;

  return result.displayName;
}

function selectResult(result) {
  // Read fresh at add time (not cached at module scope) so a Design-tab
  // edit to the default pin appearance takes effect on the very next
  // search-add, with no store/subscription needed for a value that's only
  // ever read once per pin creation.
  const defaultPin = loadDefaultPin();
  const pin = addPin({
    name: shortName(result),
    lat: result.lat,
    lon: result.lon,
    // color: null — INHERIT rather than stamp a snapshot of the current
    // default (2026-08-11 pin-color-precedence flip). A new pin follows
    // the default-pin config's color live (js/pins.js's resolvePinColor,
    // via js/map.js's effectiveColor), so a later edit to the Design-tab
    // default recolors every never-customized pin in one place instead of
    // only pins added after the edit.
    color: null,
    icon: defaultPin.icon,
    // Capture the geocoded origin once at creation (FBL-008). The pin
    // itself is fixed in place and can never be dragged off it, so no UI
    // currently reads this — kept for compatibility with already-persisted
    // data (see CLAUDE.md's pin data model).
    originalLat: result.lat,
    originalLon: result.lon,
  });
  inputEl.value = "";
  clearDropdown();
  try {
    onPinAdded?.(pin);
  } catch (err) {
    console.error("onPinAdded hook failed:", err);
  }
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
    cancelPending();
    clearDropdown();
    return;
  }
  const hasResults = !listEl.hidden && currentResults.length > 0;
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && hasResults) {
    event.preventDefault();
    const n = currentResults.length;
    const step = event.key === "ArrowDown" ? 1 : -1;
    setActive((activeIdx + step + n) % n);
    return;
  }
  if (event.key !== "Enter") return;
  if (hasResults && !searching && debounceTimer === null) {
    event.preventDefault();
    selectResult(currentResults[Math.max(activeIdx, 0)]);
    return;
  }
  // Results not here yet: skip the rest of the debounce and pick the first
  // hit on arrival instead of silently ignoring the keypress.
  const query = inputEl.value.trim();
  if (query.length < MIN_QUERY_LEN) return;
  event.preventDefault();
  pendingPick = true;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    runQuery(query);
  }
}

// Exposed for the (future) test harness; not used in production code.
// DEFAULT_PIN_COLOR was dropped from here in the 2026-08-11 pin-color-
// precedence flip: this module no longer stamps a color at all (new pins
// get `color: null`), and js/pins.test.mjs already covers the constant.
export const __internals = { DEBOUNCE_MS, MIN_QUERY_LEN, shortName };
