// HARDEN-008 spike — MapLibre GL + OpenFreeMap evaluation.
// Throwaway prototype; production-shape decisions live in the findings doc.

// preserveDrawingBuffer keeps the WebGL framebuffer alive between paints so
// canvas.toDataURL() returns real pixels instead of a blank/black image.
// Trade-off: the GPU has to copy the framebuffer each frame, costing ~5–15%
// FPS on map pan in MapLibre's own benchmarks. For this app's scale (idle
// most of the time, sub-second pans) the cost is invisible to the user.
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [0, 20], // matches production app's [20, 0] [lat, lon] → [lon, lat] for MapLibre
  zoom: 1.5,
  preserveDrawingBuffer: true,
});

// Track our markers so the export step knows what's pinned. MapLibre's
// `Marker` class manages its own DOM element, so we only need the array
// to count + iterate; no manual position bookkeeping.
const markers = [];

// Expose hooks for the spike's screenshot driver (Playwright). Throwaway
// surface; production code would never do this.
window.__spike = { map, markers, addMarker };

map.on("load", () => {
  // Click anywhere on the map → drop a draggable marker.
  // We skip the click if the user clicked on an existing marker because
  // MapLibre will fire both events; checking originalEvent.target's class
  // is the documented pattern.
  map.on("click", (e) => {
    if (e.originalEvent.target.closest(".maplibregl-marker")) return;
    addMarker(e.lngLat);
  });
});

function addMarker(lngLat) {
  // Marker `draggable: true` is the spike-friendly path: zero custom event
  // wiring vs. the GeoJSONSource-update pattern that production code would
  // use to render hundreds of markers as a single GPU layer. For tens of
  // pins the difference is invisible; the trade-off is documented in the
  // findings doc.
  const marker = new maplibregl.Marker({
    color: "#e63946",
    draggable: true,
  })
    .setLngLat(lngLat)
    .addTo(map);

  markers.push(marker);
}

// Export pipeline — the load-bearing question for this whole spike.
//
// Strategy: composite the MapLibre canvas onto a fresh 2D canvas with a
// title strip drawn on top. No dom-to-image-more, no DOM walk; just two
// drawImage calls and toDataURL.
//
// This is the pattern MapLibre/Mapbox docs themselves recommend for
// programmatic export. If it works, the production export.js rewrite
// shrinks to ~50 lines (vs. its current ~250). If it doesn't, the spike
// has answered the load-bearing question and the recommendation is PARK.
document.getElementById("export-btn").addEventListener("click", async () => {
  // Force a synchronous re-render so toDataURL captures the current state
  // and not the post-pan stale framebuffer. Documented MapLibre pattern.
  map.triggerRepaint();
  await new Promise((resolve) => map.once("render", resolve));

  const mapCanvas = map.getCanvas();
  const titleHeight = 60;
  const out = document.createElement("canvas");
  out.width = mapCanvas.width;
  out.height = mapCanvas.height + titleHeight;

  const ctx = out.getContext("2d");

  // Title strip — solid background + centered text. No webfont so we don't
  // hit the canvas-cross-origin-font tainting trap that bit dom-to-image
  // historically.
  ctx.fillStyle = "#1d3557";
  ctx.fillRect(0, 0, out.width, titleHeight);
  ctx.fillStyle = "#f1faee";
  ctx.font = "600 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("MapLibre Spike", out.width / 2, titleHeight / 2);

  // Map canvas below the title.
  ctx.drawImage(mapCanvas, 0, titleHeight);

  // CRITICAL: MapLibre's Marker class uses an HTML <div> overlay positioned
  // on top of the canvas — getCanvas().toDataURL() captures WebGL pixels
  // ONLY, so markers vanish from the export. The fix is to project each
  // marker's lngLat to canvas pixel coordinates and draw it manually onto
  // the off-screen canvas. This is also why a real port would likely move
  // markers to a WebGL GeoJSONSource layer instead — single source of
  // truth in the canvas, no post-render compositing needed.
  const dpr = window.devicePixelRatio || 1;
  const markerRadius = 8 * dpr;
  for (const marker of markers) {
    const lngLat = marker.getLngLat();
    const point = map.project(lngLat); // CSS pixels relative to map container
    const x = point.x * dpr;
    const y = point.y * dpr + titleHeight;
    ctx.beginPath();
    ctx.arc(x, y, markerRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#e63946";
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  // toDataURL → anchor click → file save. Same pattern js/export.js uses
  // at the end of its pipeline.
  const dataUrl = out.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `maplibre-spike-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});
