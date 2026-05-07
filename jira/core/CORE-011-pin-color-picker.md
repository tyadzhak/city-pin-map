# CORE-011: Choose a pin's color

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-011`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `CORE-008`                                  |

## Summary

Let the user change a pin's color from the side-panel list. The new color updates the row's swatch and the map marker, and persists across reloads. After this task the user can color-code pins (e.g. cities visited vs. wishlisted, or by trip).

## Context

The pin store and rendering layers already react to color changes — CORE-005 updates the marker, CORE-008 updates the swatch, CORE-004 persists the change. This task is purely a UI affordance for picking a color.

The pin's `color` field is a hex string per `CLAUDE.md` → "Pin data model". Browsers ship a built-in `<input type="color">` that returns hex values directly — using it avoids pulling in a color-picker library and keeps Core dependency-free.

## Acceptance criteria

- [x] Each pin list row exposes a color picker control. Clicking the row's swatch (or a small dedicated button) opens the browser's native color picker.
- [x] Selecting a color in the picker updates the pin's color via `updatePin`. The swatch updates immediately, and the map marker recolors immediately.
- [x] The new color persists across page reloads.
- [x] The color picker is keyboard-accessible (Tab to focus, Enter/Space to open the native picker).
- [x] If the user opens the picker but cancels it, no change is committed.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/pin-list.js
~ css/styles.css
```

## Out of scope

- No custom color picker UI — use the browser's native `<input type="color">`.
- No saved color palettes or per-trip color groups — that's the v2 grouping feature (`PROJECT.md` → "Nice-to-have").
- No alpha/transparency. Hex `#rrggbb` only.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. CLAUDE.md → "Pin data model" specifies that color is a hex string like "#e63946" — keep that contract.

Task: Add a per-row color picker to the pin list that updates the pin's color via the pin store.

Requirements:
- In js/pin-list.js, render a hidden `<input type="color">` per row, alongside the visible swatch element. Set its `value` to the current pin's color.
- Wire the visible swatch (or a button containing the swatch) so that clicking it triggers `colorInput.click()` — this opens the browser's native picker tied to the hidden input.
- Listen for `change` on the color input. On change, call `updatePin(pin.id, { color: input.value })`.
- The pin store fans the change out to the row swatch (CORE-008) and the map marker (CORE-005). Verify both update without manual DOM patching here.
- Make sure the swatch acts like a button: tabindex=0, role="button", aria-label like `Change color of pin ${pin.name}`. Pressing Enter or Space on the focused swatch should also open the picker.
- Style the swatch so it looks clickable: cursor pointer, subtle hover and focus rings.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Use the browser's native `<input type="color">`. Do not add a color-picker dependency.
- Vanilla DOM, no frameworks.
- Color values must be hex strings (`#rrggbb`). Do not write rgb() or named colors into the pin store.

Deliverables:
- Updated js/pin-list.js with the color picker wired in.
- Updated css/styles.css with swatch hover/focus/cursor styles.

Verification:
- Add a pin; click its swatch; pick a different color in the native picker — the swatch updates and the marker on the map recolors.
- Refresh; the new color persists.
- Tab to a swatch; press Enter — the native color picker opens.
- Open the picker, press Escape (or close without picking) — the pin's color is unchanged.
- Inspect the saved JSON in localStorage — the `color` field is a hex string.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

`<input type="color">` always returns a 7-character `#rrggbb` string regardless of OS, so no normalization is needed. On Safari the native picker is a bit limited in features but functional.
