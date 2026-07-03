# FBL-007 (NEEDS REVIEW): user-icon `add()` lets caller-supplied `id`/`createdAt` override the generated ones (latent, inverted spread order)

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-007`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done` (latent — no current caller triggers it) |
| **Severity**    | `Low`                                       |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | None                                        |

## Summary

`js/user-icons.js` `add()` builds the entity as:

```js
userIcons.push({
  id: crypto.randomUUID(),
  createdAt: Date.now(),
  ...icon,          // ← caller's fields spread LAST — they win
});
```

This is the **opposite** order of the sibling stores: `pins.js addPin()` and `groups.js addGroup()` construct the object explicitly so the store always owns `id` and `createdAt`. Here, any caller passing an object that happens to contain `id` or `createdAt` silently overrides the generated values — including a non-unique or non-string `id`, which would break per-icon delete (`remove(id)` splices the first match), MapLibre image-id namespacing (`city-pin-map.icon.<id>`), and pin→icon references.

**Why "needs review" rather than a confirmed bug:** the only current caller (`js/icon-picker.js`, "Add to my icons" handler, lines ~400–409) passes exactly `{ name, tintable, fillSvg, attribution }` — no `id`, no `createdAt` — so today nothing misbehaves. This is a landmine, not an explosion: FBL-004's fix (backup import normalization) or any future bulk-add path could plausibly pass richer objects and trip it.

## Context

- `js/user-icons.js` lines 29–36 (`add()`).
- Contrast: `js/pins.js` lines 32–46, `js/groups.js` lines 20–30 — explicit field lists, store-owned identity.
- CLAUDE.md documents the user-icon store as "mirrors pins.js pub/sub shape"; the identity-ownership convention should mirror too.

## Steps to reproduce (synthetic — demonstrates the latent behavior only)

1. In DevTools on a loaded page: `import("./js/user-icons.js").then(m => { m.add({ name: "a", tintable: true, fillSvg: "<svg/>", id: "dup" }); m.add({ name: "b", tintable: true, fillSvg: "<svg/>", id: "dup" }); })`
2. Both entries share `id: "dup"`; the icon picker renders two tiles whose delete button removes the *first* match, and both resolve to the same MapLibre image.

## Suggested fix

Flip to the pins.js pattern — construct explicitly:

```js
export function add(icon) {
  userIcons.push({
    id: crypto.randomUUID(),
    name: icon.name,
    tintable: Boolean(icon.tintable),
    fillSvg: icon.fillSvg,
    attribution: icon.attribution ?? null,
    createdAt: Date.now(),
  });
  notify();
}
```

(Note: `replaceAll()` intentionally keeps foreign ids — that's the backup-restore path and should not change.)

## Acceptance criteria

- [x] `add()` always generates `id` and `createdAt` regardless of caller input.
- [x] The icon-picker add flow works unchanged (add, render, select, delete).
- [x] `replaceAll()` semantics untouched (backup restore keeps stored ids).
- [x] No errors in browser console.

## Files affected

```
~ js/user-icons.js
```

## Notes

Filed during a full-codebase correctness review (2026-07-03) as *needs review*: not reachable through any current UI path, but a one-line convention divergence from the sibling stores with real breakage potential once other code (e.g. the FBL-004 import normalizer) starts calling `add()`.
