// Pure, DOM-free export-size math for the Quality select (UXR-016).
//
// Print quality never changes the composition: the camera and layout stay as
// previewed (UXR-001) and only the OUTPUT WIDTH grows, with the height derived
// proportionally from the preset's own aspect ratio. Only the 96-dpi A-series
// presets are print-eligible; the photo presets are already 300 dpi, and
// square / 16:9 / current view have no physical paper size to print at.

// 300 dpi widths for the A-series, in px (A4 210 mm → 2480, A3 297 mm → 3508,
// A4 297 mm → 3508, A3 420 mm → 4961).
const PRINT_WIDTHS = {
  "a4-portrait": 2480,
  "a4-landscape": 3508,
  "a3-portrait": 3508,
  "a3-landscape": 4961,
};

export function isPrintEligible(presetId) {
  return Object.prototype.hasOwnProperty.call(PRINT_WIDTHS, presetId);
}

/**
 * Resolve the output size for a preset at a quality. Returns null for the
 * "current" view (no preset). Presets that are not print-eligible ignore
 * `quality` and come back unchanged.
 * @param {string} presetId
 * @param {{width:number,height:number}|null} preset
 * @param {string} quality "screen" | "print"
 * @returns {{width:number,height:number}|null}
 */
export function resolveExportSize(presetId, preset, quality) {
  if (!preset) return null;
  if (quality !== "print" || !isPrintEligible(presetId)) {
    return { width: preset.width, height: preset.height };
  }
  const width = PRINT_WIDTHS[presetId];
  return {
    width,
    height: Math.round((width * preset.height) / preset.width),
  };
}
