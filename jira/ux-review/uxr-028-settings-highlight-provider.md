# UXR-028: Locked basemap opens Settings without showing which key is needed

| Field         | Value        |
|---------------|--------------|
| **ID**        | `UXR-028`    |
| **Milestone** | `UX review`  |
| **Status**    | `Done`       |
| **Severity**  | `Low`        |
| **Priority**  | `Low`        |

## Summary

Clicking a locked basemap in the picker opened the Settings modal with no hint which provider key was needed, and 22 of 29 styles were listed inline as locked rows.

## Context

**Files:** `js/style-picker.js`, `js/settings-panel.js`, `js/app.js`, `css/styles.css`

- `openSettingsScrolledTo(provider)` scrolled and focused the input but gave no visual emphasis and no style name.
- `renderRows()` listed locked and unlocked styles together.

## Failure scenario

The user clicks "Watercolor", Settings opens at some section, and nothing says "this is the Stadia key you need for the style you clicked".

## Fix direction

- The picker passes the style label through `onOpenSettings(provider, label)`; `app.js` forwards it to `openSettingsScrolledTo(provider, styleLabel)`.
- Settings highlights the provider section (accent border/background, one pulse, reduced-motion safe), focuses its input and inserts a note "“Watercolor” needs a free Stadia Maps key." Highlight and note clear on close/reopen.
- The picker renders unlocked styles per provider as before; locked styles move under a collapsed "More styles — free key needed" toggle (keyboard accessible), force-expanded while searching so search still finds everything. Collapsed again on close.

## Acceptance criteria

- [x] A locked click opens Settings with the right provider highlighted and focused. *(`.is-highlighted` + `input.focus()` in `openModal`.)*
- [x] The style name is mentioned. *(`.settings-section__needed` note.)*
- [x] Default picker list is shorter and search still finds everything. *(Locked rows hidden until expanded; search forces expansion.)*
- [x] Coverage scenarios still valid. *(They use `topo`/`osm` rows, both unlocked.)*
- [x] `node --check` and `node --test js/*.test.mjs` pass.

## Files affected

```
~ js/style-picker.js
~ js/settings-panel.js
~ js/app.js
~ css/styles.css
+ jira/ux-review/uxr-028-settings-highlight-provider.md
```
