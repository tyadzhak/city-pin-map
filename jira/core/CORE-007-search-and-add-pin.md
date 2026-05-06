# CORE-007: City search input and adding a pin

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-007`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `CORE-005`, `CORE-006`                      |

## Summary

Wire a search input in the header to the geocoder, render a list of suggestions as the user types (debounced), and add a pin to the store when a suggestion is chosen. After this task, the user can place pins by typing city names.

## Context

CORE-006 provided the geocoding wrapper with rate limiting and caching. This task adds the user-facing UI on top: a debounced text input, a dropdown of candidate cities, and selecting one adds a pin via the pin store from CORE-003. The pin then automatically appears on the map (CORE-005).

`CLAUDE.md` → "Hard rules" requires debouncing the input. The wrapper enforces server-side rate limits; the UI enforces a typing-time debounce so we don't queue up dozens of requests as the user types.

## Acceptance criteria

- [ ] The header contains a search input with a placeholder like "Search a city…".
- [ ] Typing into the input shows a dropdown of up to 8 candidate cities under the input within ~400 ms of the user stopping.
- [ ] No requests are sent for queries shorter than 2 characters.
- [ ] Clicking a candidate adds a new pin (`name` defaults to that candidate's `displayName`, lat/lon from the candidate, default color), the dropdown closes, and the input clears.
- [ ] Pressing Enter with the dropdown open selects the first candidate (same effect as clicking it).
- [ ] Pressing Escape closes the dropdown without adding a pin.
- [ ] If the geocoder errors, the dropdown shows a single visible error row and the page-level error banner from CORE-004 displays the message.
- [ ] Adding a pin via search reflects on the map immediately and persists across reload.
- [ ] No regressions in previously completed tasks.
- [ ] No errors in browser console.

## Files affected

```
~ index.html
~ css/styles.css
~ js/app.js
+ js/search.js
```

## Out of scope

- Keyboard navigation through suggestions (arrow keys to highlight) is nice but not required for Core. Enter-selects-first and Escape-closes are required; richer keyboard nav can be a follow-up.
- No "recent searches" history.
- No multi-pin batch add.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Note CLAUDE.md → "Hard rules" (debounce search input) and "Coding conventions" (vanilla DOM, no jQuery, async/await).

Task: Build a debounced city-search UI in the header that adds pins via the pin store when a candidate is chosen.

Requirements:
- In index.html, replace the placeholder header content with: a labeled <input id="search-input" type="search"> and an empty <ul id="search-results" hidden> directly below it. Both live inside a relatively-positioned wrapper so the dropdown overlays the page.
- New module js/search.js exports `initSearch()`. It:
  - Wires `input` and `keydown` listeners on `#search-input`.
  - Debounces query handling at 300–400 ms — only after the user stops typing for that long does it call `searchCities`.
  - Uses an `AbortController` to cancel the in-flight request when a new query starts, so stale results never overwrite fresh ones.
  - Skips queries shorter than 2 trimmed characters; clears the dropdown in that case.
  - Renders results into `#search-results` as <li> rows showing the displayName.
  - On click of a row, calls `addPin({ name: displayName, lat, lon, color: defaultColor })`, hides the dropdown, clears the input.
  - On Enter while dropdown is visible with results, selects the first row.
  - On Escape, hides the dropdown.
  - On geocode error, renders a single error row inside the dropdown AND calls `showError(message)` from js/storage.js (the banner helper from CORE-004).
- Define a `DEFAULT_PIN_COLOR` constant near the top of js/search.js (or in a small shared constants file); pick something visible like '#e63946'.
- In js/app.js, call `initSearch()` after the rest of the bootstrap.
- Style the dropdown in css/styles.css: solid background, a subtle shadow, hover state on rows, max-height with vertical scroll for long lists.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Vanilla DOM (`querySelector`, `addEventListener`). No jQuery.
- async/await over .then chains.
- Show user-visible feedback for failures — never silently swallow (CLAUDE.md → "Coding conventions").

Deliverables:
- New js/search.js exporting `initSearch()`.
- Updated index.html with the search UI markup.
- Updated css/styles.css with dropdown styles.
- Updated js/app.js wiring the search init.

Verification:
- Open the app, type "Tok" — within ~400 ms a dropdown shows several Tokyo-related candidates.
- Click "Tokyo, Japan" — a pin appears on the map at Tokyo, the input clears, the dropdown closes, refreshing keeps the pin.
- Type a short string (1 char) — no network request fires (verify in DevTools Network tab).
- Type fast across many characters — only one or two requests fire, separated per the rate-limit policy.
- Disconnect network and search — error row appears in dropdown and the page-level banner shows the error message.
- Press Escape with the dropdown open — dropdown hides without adding a pin.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

The pattern of "debounce in UI, rate-limit in wrapper" prevents two distinct failure modes: spammy fetches while typing (UI-side) and quota throttling from the server (wrapper-side). Both must exist; one is not a substitute for the other.
