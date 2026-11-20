# FBL-024: Pin-list color swatch `input` handler re-renders the list and closes the native picker

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-024`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `High`                                      |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

The per-pin native `<input type="color">` swatch in the pin list committed on both `input` and `change`. Every `input` tick (fired continuously while the user scrubs the native picker) called `updatePin`, which notifies the pin store and rebuilds the whole pin list, detaching the open color input. Chrome closes the native picker when its input is removed from the DOM, so the user could not drag through colors: the picker died after the first tick. Where the old element survived, the dedupe guard compared against the stale closure `pin`, so every later tick rewrote the store and `localStorage` and re-rendered the map, list, labels and inset.

## Context

**Files:** `js/pin-list.js`

- `buildAppearanceTile()` attached `commitColor` to both `input` and `change`.
- The code comment claimed `input` was needed so an inherited (`pin.color === null`) pin re-committing the shade it already shows becomes concrete. That is wrong: re-picking the same value fires neither `input` nor `change`, so `input` never handled that case.
- Introduced by the 2026-08-11 pin-color-precedence flip.

## Failure scenario

User clicks a pin's color swatch and starts dragging in the native picker. The first `input` tick writes the color, the list re-renders, the swatch element is replaced, and the picker closes mid-drag. Any later ticks on a surviving element repeat the full write + re-render cascade because the guard sees the stale closure `pin`.

## Fix direction

Commit on `change` only (fires once when the picker is committed/dismissed), drop the `input` listener, keep the stored-color guard and the inherited-swatch cue, and correct the comment. A live map preview while dragging is intentionally given up.

## Acceptance criteria

- [x] Dragging within the native picker no longer re-renders the pin list or detaches the color input mid-drag. *(Runtime-only to fully confirm in a real browser; by construction: the only listener left is `change`, so `input` ticks never reach `updatePin`.)*
- [x] Committing a color writes it exactly once and the pin recolors on the map, list and inset as before. *(`change` still calls `updatePin(pin.id, { color })`, unchanged store path.)*
- [x] The inherited-swatch cue (dotted border + tooltip) and the guard against redundant writes are preserved. *(Both untouched.)*
- [x] The misleading code comment is replaced with one that states the actual behavior and trade-off. *(Rewritten above the listener.)*
- [x] `node --check js/pin-list.js` passes and `node --test js/*.test.mjs` passes. *(See run results in the fix report.)*
- [ ] No errors in the browser console. *(Runtime-only; requires loading the app in a browser.)*

## Files affected

```
~ js/pin-list.js
+ jira/fable_findings/finding-024-pin-swatch-input-rerender-closes-picker.md
```

## Notes

Stale CLAUDE.md text to update in a later docs pass: the pin-color-precedence-flip bullet says the swatch "listens on `input` as well as `change` — guarded to write only when the value differs from the pin's stored color (`null` always differs) — so opening the picker on an inherited pin and committing the shade it already shows pins that shade concretely instead of no-op'ing." It now listens on `change` only, and re-picking the identical shade is a no-op (no event fires).
