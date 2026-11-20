# FBL-029: Pin-list rows show the default circle instead of custom icons after a backup import

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-029`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

The side-panel pin list subscribed its render only to the pin store and the group store, never to the icon registry (`js/icons.js`). `js/backup.js` replaces pins BEFORE user icons, so importing a v2/v3 backup on a device that lacks its custom icons renders the pin-list rows while those icons don't exist yet; `effectiveIcon()` clamps every such pin to the default circle. Nothing re-rendered the list after `userIconStore.replaceAll` fired, so every tile stayed a circle until an unrelated pin or group edit. The map itself updated, because `js/map.js` subscribes to the icon registry.

## Context

**Files:** `js/pin-list.js`, `js/backup.js`, `js/icons.js`, `js/app.js`

- `js/backup.js` (~lines 194-197) — `groupStore.replaceAll(groups)`, `pinStore.replaceAll(pins)`, then `userIconStore.replaceAll(userIcons)`.
- `js/pin-list.js` `initPinList()` — subscribed `requestRender` to pins and groups only.
- `js/app.js` (~lines 866-871, default-pin tile) — comment claimed pin-list.js already follows a "subscribe-and-re-render contract" for icon changes; that was not true until this fix.

## Failure scenario

Clean profile, import a v3 backup containing one user icon and one pin that references it. The pin renders with the custom icon on the map but the pin-list row's icon tile shows the default circle until the user edits some pin or group.

## Fix direction

Subscribe the pin list to the icon registry and route notifications through the rename-safe `requestRender()` (not a direct render), so an icon-library change during an in-progress rename defers instead of destroying the rename input (FBL-021).

## Acceptance criteria

- [x] After importing a backup whose pins reference user icons not yet in the library, pin-list tiles show the custom icons without any further interaction. *(Runtime-only to fully confirm; by construction: `userIconStore.replaceAll` notifies the icon registry, which now fires `requestRender` -> `renderNow()` -> `buildRow` -> `effectiveIcon(pin)` against the freshly merged registry.)*
- [x] An icon-library change during an in-progress rename does not destroy the rename input. *(Runtime-only; by construction: the subscription is `requestRender`, which only sets `renderPending` while `renameActive`, and `finalize()` flushes it once the edit resolves.)*
- [x] Hydrate-then-subscribe ordering respected and no double subscription. *(`initPinList()` already runs after `attachUserIconStorage` in `app.js`; it adds exactly one `subscribeIcons` call, torn down by the returned unsubscribe function. The existing `renderNow()` backfill covers the hydration notify.)*
- [x] The `js/app.js` comment about pin-list's icon subscription is accurate. *(It is now true; left unchanged.)*
- [x] `node --check js/pin-list.js` passes and `node --test js/*.test.mjs` passes.
- [ ] No errors in the browser console. *(Runtime-only; requires loading the app in a browser.)*

## Files affected

```
~ js/pin-list.js
+ jira/fable_findings/finding-029-pin-list-stale-icons-after-import.md
```

## Notes

Pin-list is DOM-heavy with no node unit test, so none was added. Suggested browser scenario: import a v3 backup (one user icon, one pin using it) via the Import JSON file input on a clean profile and assert the row tile's image is the custom icon; separately, start a rename and trigger an icon-library change (e.g. add or delete a user icon) and assert the rename input survives and the list refreshes after commit.
