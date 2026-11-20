# UXR-018: Inset map: confusing enable flow and stale state after its group is deleted

| Field           | Value         |
|-----------------|---------------|
| **ID**          | `UXR-018`     |
| **Milestone**   | `UX review`   |
| **Status**      | `Done`        |
| **Severity**    | `Medium`      |
| **Priority**    | `Medium`      |

## Summary

Ticking "Show inset map" showed nothing until a group was picked, and the group select can sit below the sticky Export footer. Deleting the chosen group hid the inset but left the checkbox ticked.

## Context

**Files:** `js/app.js` (`initInsetOptions`), `css/styles.css` (`.inset-group-hint`)

## Failure scenario

The user ticks the checkbox, sees no change, and cannot see the Group select without scrolling. Later they delete the group in the Groups tab and the checkbox stays ticked over an invisible inset.

## Fix direction

- On enable with no group chosen, the first existing group is selected automatically.
- The controls are scrolled into view (`scrollIntoView({ block: "nearest" })`).
- The "Create a group" hint is shown only when enabled with zero groups, styled as a callout.
- When the chosen group disappears from the store, `setState` (UXR-021 handle) unticks, clears `groupId`, persists and updates the overlay; an info toast is shown.

## Acceptance criteria

- [x] Enabling shows an inset immediately when groups exist. *(Playwright smoke: 2 groups, tick -> select = first group, persisted groupId `g0`, inset box present.)*
- [x] The controls are visible after enabling. *(`scrollIntoView` on `#inset-controls`.)*
- [x] Deleting the group unticks the inset with feedback. *(Smoke: checkbox false, stored enabled false/groupId null, toast text present.)*
- [x] Zero groups: hint shown prominently when ticked. *(Smoke: hint not hidden.)*
- [x] `node --check` and `node --test js/*.test.mjs` pass.

## Files affected

```
~ js/app.js
~ css/styles.css
+ jira/ux-review/uxr-018-inset-enable-flow.md
```
