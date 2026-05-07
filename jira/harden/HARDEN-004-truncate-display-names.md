# HARDEN-004: Truncate Nominatim display names to readable defaults

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-004`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S`                                         |
| **Depends on**  | `None`                                      |

## Summary

When a user picks a search result, the new pin's name today is whatever Nominatim returned in `display_name` — typically a long comma-separated string like `"Lisboa, Lisbon, Lisbon Region, 1100-205, Portugal"`. The side-panel rows wrap, the marker tooltip is unwieldy, and the eventual exported PNG inherits the noise. Default to a short `"city, country"` form at pin creation. The user can still rename to whatever they want via the existing CORE-010 flow.

## Context

`js/search.js` → `selectResult()` calls `addPin({ name: result.displayName, ... })`. `result.displayName` is `display_name` straight from Nominatim with no transformation. A modest cleanup at this single site fixes both the side panel and the marker tooltip (`map.js` → `bindTooltip(pin.name)`), since both read `pin.name`.

Nominatim search results also expose `address` fields (`city`, `town`, `village`, `country`) when `addressdetails=1` is passed. The current request does not include that flag (`js/geocode.js` builds the URL with `format`, `limit`, `accept-language`, `q`). The cleanest implementation is to add `addressdetails=1` and pick `(city || town || village || municipality || county) + ", " + country` when those fields are present, falling back to a string-split heuristic on `display_name` when they aren't.

`CLAUDE.md` → "Hard rules" #4 still applies: this task does not change request rate, only adds an extra response field.

## Acceptance criteria

- [x] After picking a search result, the new pin's `name` is in a short readable form. Examples:
  - `"Lisboa, Portugal"` (not `"Lisboa, Lisbon, Lisbon Region, 1100-205, Portugal"`)
  - `"Tokyo, Japan"`
  - `"San Francisco, United States"`
- [x] If Nominatim returns a result with no recognizable city/town field (e.g. a feature, a building), fall back to: take everything before the first comma, plus the country if it's the last segment. Example: `"Eiffel Tower, France"` → `"Eiffel Tower, France"`.
- [x] If even the fallback fails (single-segment display name), use `display_name` as-is — never end up with an empty pin name.
- [x] The Nominatim request now includes `addressdetails=1`.
- [x] The dropdown of search results in the header continues to show the **full** `display_name` so the user can disambiguate ("Springfield, Illinois" vs "Springfield, Missouri"). Only the saved pin name is shortened.
- [x] Existing pins in storage are untouched. The shortening applies to **new** pins only.
- [x] No regressions: rename, recolor, drag, group assignment, route, export — all still work on the new short-name pins.
- [x] No errors in browser console.

## Files affected

```
~ js/geocode.js
~ js/search.js
```

## Out of scope

- Retroactively shortening existing pin names. They were the user's choice (or were named under the old behavior); rewriting them silently is worse than leaving them alone. The user can rename a row at any time.
- Localised forms ("Lisboa" vs "Lisbon"). The `accept-language=en` header on the request already steers Nominatim toward the English form where available; that's enough.
- A user-configurable name format. One sensible default is the whole point.
- Extracting the city out of `display_name` via complex regex when `address` fields are missing. The fallback is intentionally simple — one comma-split rule.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read this task file in full.

Task: Default new pin names to a short "city, country" form instead of the full Nominatim display_name.

Requirements:
- In js/geocode.js: add addressdetails=1 to the request URL. Map each result
  to { displayName, lat, lon, address } where `address` is the raw address
  object Nominatim returned (or null if absent). Keep `displayName` unchanged
  so the search dropdown still shows the long form.
- In js/search.js: add a small helper shortName(result) that returns:
  1. `${city}, ${country}` when address fields supply both, where `city` is
     the first non-empty of city / town / village / municipality / county.
  2. Otherwise, the segment before the first comma of displayName, plus
     ", ${country}" if address.country is present.
  3. Otherwise, displayName unchanged.
  Use this helper in selectResult() when calling addPin.
- The search dropdown rows (renderResults) keep using displayName verbatim.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Do not change the rate limit or debouncing.
- Do not retroactively rewrite any existing pins.

Deliverables:
- js/geocode.js — addressdetails=1 + shape change to include `address`.
- js/search.js — new shortName helper + selectResult updated.

Verification:
- Search for "Lisbon", click the first result. The new pin's side-panel row
  reads "Lisboa, Portugal" (or similar two-segment form). The marker tooltip
  matches.
- Search for a more obscure place that lacks city/town/village in the
  address — confirm the comma-split fallback produces a sensible name.
- Confirm existing pins (created before the change) keep their previous
  names verbatim.
- All acceptance criteria in this task file are satisfied.

When finished:
- Update this task file's Status field to `Done` and tick every acceptance
  criteria checkbox.
- Create a feature branch `harden-004-truncate-display-names`.
- Commit with message
  `HARDEN-004: default new pin names to "city, country"` and the
  Co-Authored-By footer matching this repo's commit style.
- Push the branch and open a pull request titled
  `HARDEN-004: default new pin names to "city, country"` against `main`.
```

## Notes

- Nominatim's `address` block can include surprising keys depending on the place type (`hamlet`, `suburb`, etc.). The five-field fallback chain is intentionally short — adding more keys is easy if a real-world result misses, but premature width here is just noise.
