// Pure, DOM-free greedy label collision avoidance (UXR-019). Labels default to
// sitting just below their pin, which stacks into an unreadable pile when pins
// cluster. This picks, per un-dragged label, the first of eight candidate
// positions whose box doesn't hit an already-placed label or any pin icon.
//
// Everything is expressed in the SAME px space as the caller's specs, and every
// candidate gap scales off `labelSize`/`iconSize` (which the caller already
// multiplies by sizeMultiplier), so the live view and the export produce the
// same arrangement. Text width comes from an injected `measure(text, font)` so
// this stays node-testable.

const GAP_EMS = 0.25; // breathing room between a label and what it avoids
const LINE_HEIGHT = 1.25; // label box height in ems of the label size

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * @param {object} opts
 * @param {Array<{id:string, ax:number, ay:number, text:string, manual:boolean,
 *   x:number, y:number}>} opts.items  ax/ay = pin anchor (icon bottom-center);
 *   x = default label CENTER, y = default label TOP (used as-is when manual
 *   and as the fallback when no candidate is free). Caller passes them in the
 *   stable placement order (createdAt).
 * @param {number} opts.labelSize  label font px (already size-multiplied)
 * @param {number} opts.iconSize   pin icon px (already size-multiplied)
 * @param {string} opts.font       CSS font shorthand for measuring
 * @param {(text:string, font:string)=>number} opts.measure
 * @returns {Map<string,{x:number,y:number}>} id -> label {center x, top y}
 */
export function layoutLabels({ items, labelSize, iconSize, font, measure }) {
  const result = new Map();
  if (!Array.isArray(items) || items.length === 0) return result;

  const h = labelSize * LINE_HEIGHT;
  const gap = labelSize * GAP_EMS;
  const half = iconSize / 2;
  const widthOf = (text) => {
    const w = measure(text, font);
    return Number.isFinite(w) && w >= 0 ? w : text.length * labelSize * 0.6;
  };

  const placed = [];
  // Pin icons are obstacles for every label (anchor = bottom-center).
  for (const it of items) {
    placed.push({ x: it.ax - half, y: it.ay - iconSize, w: iconSize, h: iconSize });
  }
  // Manually positioned labels always win: fixed obstacles, never moved.
  for (const it of items) {
    if (!it.manual) continue;
    const w = widthOf(it.text);
    placed.push({ x: it.x - w / 2, y: it.y, w, h });
    result.set(it.id, { x: it.x, y: it.y });
  }

  for (const it of items) {
    if (it.manual) continue;
    const w = widthOf(it.text);
    const belowTop = it.y; // the legacy default: 1em under the anchor
    const aboveTop = it.ay - iconSize - h - gap;
    const midTop = it.ay - iconSize / 2 - h / 2;
    const rightLeft = it.ax + half + gap;
    const leftLeft = it.ax - half - gap - w;
    // [left edge, top edge]; order is the spec's preference order.
    const candidates = [
      [it.ax - w / 2, belowTop], // below
      [it.ax - w / 2, aboveTop], // above
      [rightLeft, midTop], // right
      [leftLeft, midTop], // left
      [it.ax, belowTop], // below-right
      [it.ax - w, belowTop], // below-left
      [it.ax, aboveTop], // above-right
      [it.ax - w, aboveTop], // above-left
    ];
    let chosen = candidates[0];
    for (const c of candidates) {
      const box = { x: c[0], y: c[1], w, h };
      if (!placed.some((p) => overlaps(box, p))) {
        chosen = c;
        break;
      }
    }
    placed.push({ x: chosen[0], y: chosen[1], w, h });
    result.set(it.id, { x: chosen[0] + w / 2, y: chosen[1] });
  }
  return result;
}
