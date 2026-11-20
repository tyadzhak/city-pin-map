# UXR-024: Header layout breaks below about 800px width

| Field           | Value             |
|-----------------|-------------------|
| **ID**          | `UXR-024`         |
| **Milestone**   | `UX review`       |
| **Status**      | `Done`            |
| **Severity**    | `Low`             |
| **Priority**    | `Low`             |

## Summary

The top header was a single flex row with a fixed 360px search and no media queries, so at ~800px the title wrapped and clipped and the toggles wrapped.

## Context

**Files:** `css/styles.css` (`.app-header`, `.app-title`, `.search`, toggles, new `@media (max-width: 1000px)` block right after the header rules)

The settings gear (`#open-settings`, UXR-006) now sits at the right end of the header and is accounted for.

## Failure scenario

On a ~800px window "City Pin Map" wraps to three lines and clips, and the toggles wrap, so the header looks broken.

## Fix direction

- Title is `nowrap` and non-shrinking.
- Search is `flex: 1 1 auto; min-width: 180px; max-width: 360px`, so it absorbs the squeeze.
- Picker and toggles are `nowrap` and non-shrinking.
- At 1000px and below: tighter header padding and gaps, smaller title and toggle text, compact picker trigger, 280px sidebar. No label swaps were needed, so `index.html` is untouched.

## Acceptance criteria

- [x] At 800, 1024 and 1440px the header is a clean single row with no clipping or overflow. *(Playwright smoke: header height 56px, all children share one row, scrollWidth equals clientWidth at all three widths; screenshots checked.)*
- [x] The search dropdown still fits. *(Dropdown stays within the viewport and under the search field at all three widths.)*
