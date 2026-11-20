// Pure longitude-wrapping helper shared by every DOM consumer that projects a
// pin onto the screen (js/map-labels.js, js/map-select.js). Lives in its own
// dependency-free module so both can import it without one overlay module
// reaching into the other, and so node tests can load it with no DOM/MapLibre.
//
// Why it exists: both app maps keep MapLibre's default `renderWorldCopies:
// true`, so the WebGL pin icon is drawn on whichever world copy sits nearest
// the viewport — but `map.project([lon, lat])` happily projects the RAW
// longitude onto the primary copy, which can be thousands of px off-screen
// (a Samoa pin at lon -172 with the map centered on lng 150 renders at the
// 188° copy). Wrapping the longitude toward the map center before projecting
// puts the DOM label / hit-test point on the same copy as the icon — the same
// idea as MapLibre Marker's smartWrap.

/**
 * Returns `lon` shifted by a whole number of 360° turns so that
 * |result - centerLng| <= 180. Pure. `centerLng` may itself be outside
 * [-180, 180] (MapLibre lets the center drift past the antimeridian while
 * panning), which the round()-based shift handles for free. A non-finite
 * `lon` or `centerLng` returns `lon` unchanged so callers' own finite-checks
 * stay authoritative. Exactly 180° apart is a tie between two equally-near
 * copies; either is on-screen-adjacent, and the result is deterministic.
 */
export function wrapLngNear(lon, centerLng) {
  if (!Number.isFinite(lon) || !Number.isFinite(centerLng)) return lon;
  return lon + 360 * Math.round((centerLng - lon) / 360);
}

/**
 * `map.project()` for a pin, on the world copy nearest the map's current
 * center. Takes the map as a parameter (no module-level state) and degrades to
 * the raw longitude if the map can't report a center.
 */
export function projectNearCenter(map, lon, lat) {
  const center =
    typeof map.getCenter === "function" ? map.getCenter() : null;
  const wrapped = center ? wrapLngNear(lon, center.lng) : lon;
  return map.project([wrapped, lat]);
}

/**
 * UXR-033: the pins whose projected position lies inside the map's current
 * `width` x `height` box. Pure apart from `map.project`/`getCenter`, so a
 * preset letterbox change can snapshot "what is visible" before and after.
 */
export function pinsInViewport(map, pins, width, height) {
  return (pins || []).filter((p) => {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
    const pt = projectNearCenter(map, p.lon, p.lat);
    return pt.x >= 0 && pt.y >= 0 && pt.x <= width && pt.y <= height;
  });
}
