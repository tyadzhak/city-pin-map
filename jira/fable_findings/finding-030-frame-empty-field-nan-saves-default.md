# FBL-030: Clearing a frame number field makes the preview, the saved value and the export disagree

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-030`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

`readFrame` in `wireFrameControls` (`js/app.js`) passed each frame number input's `valueAsNumber` straight through. That value is `NaN` while the field is empty (e.g. mid-edit after select-all + delete). The live overlay (`js/map-frame.js`) treats that NaN as 0, but the saved value goes through `normalizeFrame()` (`js/storage.js`), which maps NaN to `DEFAULT_EXPORT_FRAME`'s value — thickness 60, even for Frame 2, whose own seeded default is 4. The preview, the persisted value and the export therefore disagreed.

The sibling `readOutside` in `wireFrameOutsideControls` has the same flaw for the "outside the frame" blur input: `blur.valueAsNumber` went raw into `normalizeFrameOutside()`, which maps NaN to `DEFAULT_FRAME_OUTSIDE.blur`, while the live overlay (`clampBlur()` in `js/map-frame.js`) and the export (`Number(outside.blur) || 0` in `paintFrameOutside`, `js/export.js`) both treat NaN as 0.

## Context

**Files:** `js/app.js`

- `js/app.js` `wireFrameControls()` — `readFrame` read `thickness`/`padding`/`margin`/`radius` via raw `valueAsNumber`.
- `js/app.js` `wireFrameOutsideControls()` — `readOutside` read `blur` via raw `valueAsNumber`.
- `readFade` in the same file already maps a non-finite `valueAsNumber` to 0 for its empty fields; the frame and outside clusters lacked the same guard.
- `normalizeFrame()` / `normalizeFrameOutside()` (`js/storage.js`) are correct for corrupt or missing *saved* data and are deliberately unchanged.

## Failure scenario

The user enables Frame 2 and clears its thickness field. The live preview shows no band (NaN treated as 0), but 60 is saved and Export PNG draws a 60 px band. If the field is left empty, a reload shows a 60 px band nobody set. Likewise, clearing the outside-blur field previews no blur while the default blur is saved and exported.

## Fix direction

Hoist one module-level `finiteOrZero(input)` helper in `js/app.js` (non-finite `valueAsNumber` -> 0, mirroring `readFade`) and use it for every numeric field in `readFrame` (thickness, padding, margin, radius) and in `readOutside` (blur). 0 is the value the live overlays and the export already use for NaN, so the preview, saved value and export agree.

## Acceptance criteria

- [x] Clearing a frame number field (thickness, padding, margin, radius) on either frame persists 0, not the `DEFAULT_EXPORT_FRAME` value. *(By construction: `readFrame` routes all four fields through `finiteOrZero`, so `normalizeFrame()` never sees NaN from the UI path. Runtime-only to fully confirm: `frames[1].thickness === 0` in `city-pin-map.export-frame.v1` after `fill('')`.)*
- [x] Clearing the outside-blur field persists `outside.blur === 0`, not the default blur. *(By construction: `readOutside` routes `blur` through the same `finiteOrZero`. Runtime-only to fully confirm.)*
- [x] The live preview, the saved value and the export all agree on the value of an empty field. *(`getLiveFrame()`, `persist()` and `mapFrame.update()` all share `readFrameSet()` -> `readFrame`/`readOutside`; the overlay's `clampBlur` and export's `Number(blur) || 0` already map NaN to 0, so all three now see 0.)*
- [x] After a reload with the field left empty, the field shows 0 rather than a phantom default. *(Runtime-only; by construction the saved 0 round-trips through the normalizers unchanged and is hydrated into the input at boot.)*
- [x] `normalizeFrame()` / `normalizeFrameOutside()` load-time defaults are unchanged for corrupt/missing saved data. *(`js/storage.js` untouched.)*
- [x] `node --check js/app.js` passes and `node --test js/*.test.mjs` passes. *(Both clean.)*
- [ ] No errors in the browser console. *(Runtime-only; requires loading the app in a browser.)*

## Files affected

```
~ js/app.js
+ jira/fable_findings/finding-030-frame-empty-field-nan-saves-default.md
```

## Notes

`wireFrameOutsideControls` was initially flagged as out of scope and then folded into this finding at the coordinator's request, as it is the same bug class in the same file.
