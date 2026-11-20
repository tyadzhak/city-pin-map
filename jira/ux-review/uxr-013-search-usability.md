# UXR-013: Search keyboard/click issues, duplicate results, no duplicate-pin cue

| Field           | Value                |
|-----------------|----------------------|
| **ID**          | `UXR-013`            |
| **Milestone**   | `UX review`          |
| **Status**      | `Done`               |
| **Severity**    | `Medium`             |
| **Priority**    | `Medium`             |

## Summary

The city search dropdown only handled Escape and Enter (Enter always took result #1 invisibly), ignored outside clicks, silently dropped an Enter pressed before results arrived, showed Nominatim's visually identical duplicates, and gave no hint that a city was already pinned.

## Context

**Files:** `js/search.js`, `js/search.test.mjs`, `css/styles.css` (next to `.search__*`)

## Failure scenario

The user types "paris", sees three identical "Paris, Ile-de-France" rows, hits Enter immediately and nothing happens, then clicks elsewhere and the dropdown stays open. They cannot tell which row Enter would pick, and they can unknowingly pin a city twice.

## Fix direction

- ArrowUp/Down (wrapping) move an active option: highlighted, `aria-activedescendant` on the input, `aria-selected`, scrolled into view; first option active by default; mouse hover also activates; Enter picks the active one.
- A "Searching…" row appears as soon as a query is debounced.
- Enter during debounce or in flight runs the query immediately and auto-picks the first result on arrival (cancelled by Escape, new typing, or outside click).
- Document-level `pointerdown` outside `.search` closes the dropdown and cancels pending work; result clicks are inside `.search` so unaffected.
- Pure exported `dedupeResults()` (same displayName, or same short name within 0.01 deg) and `isAlreadyPinned()` (same short name, or within 2 km of a pin); pinned results get an "already pinned" badge, and selecting one still adds it.

## Acceptance criteria

- [x] Keyboard navigation works. *(Test "ArrowDown moves the active option and Enter picks it".)*
- [x] Early Enter adds the first result once it arrives. *(Test "typing shows a Searching row; Enter before results picks the first on arrival"; Escape cancel covered.)*
- [x] Outside click closes the dropdown. *(`handleOutsidePointer`; DOM-only, not covered by node tests.)*
- [x] Duplicates are removed. *(`dedupeResults` tests.)*
- [x] Already-pinned results are badged. *(`isAlreadyPinned` and badge render tests.)*
- [x] Tests pass. *(`node --test js/*.test.mjs` all green; `search.test.mjs` 29/29.)*

## Files affected

```
~ js/search.js
~ js/search.test.mjs
~ css/styles.css
+ jira/ux-review/uxr-013-search-usability.md
```
