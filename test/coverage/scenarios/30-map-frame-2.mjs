// test/coverage/scenarios/30-map-frame-2.mjs — deep drive of js/map-frame.js
// (~65% covered per the coverage-batch spec), focused on the parts a single
// enabled frame can't reach: the dynamic RING POOL growing to its second
// slot (both Frame 1 and Frame 2 enabled with DIFFERENT margins → nested
// bands), a frame that's enabled but has thickness 0 (still counts toward
// the outermost-enabled-frame boundary even though it paints no ring), the
// shadow drop-shadow branch on and off per element, and both OUTSIDE-FRAME
// treatments (white box-shadow path, blur backdrop-filter + SVG mask path)
// including the ResizeObserver-driven recompute. Also toggles bottom fade
// (js/map-fade.js) alongside, since the two overlays are meant to compose.
//
// Every step is its own try/catch per test/coverage/run.mjs's contract.

const SIDE_TAB_KEY = "city-pin-map.side-tab.v1";

async function step(label, fn) {
  try {
    await fn();
    console.log(`    ✔ ${label}`);
  } catch (err) {
    console.log(`    ✘ ${label} —`, err?.message || err);
  }
}

export async function run(page) {
  // ── 0. Make sure we're on the Design tab (frame/fade controls live
  //     there) — seed via localStorage + reload rather than assuming a
  //     prior scenario left it in the right place. ────────────────────────
  await step("ensure Design tab is active and reload", async () => {
    await page.evaluate((key) => localStorage.setItem(key, "design"), SIDE_TAB_KEY);
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("#export-frame-enabled-1", { timeout: 15000 });
  });

  // ── 1. Frame 1: outer band, larger margin, thickness>0, shadow ON. ─────
  await step("configure Frame 1 (outer band, margin 24, shadow on)", async () => {
    await page.check("#export-frame-enabled-1");
    await page.fill("#export-frame-thickness-1", "18");
    await page.fill("#export-frame-color-1", "#1d3557");
    await page.fill("#export-frame-padding-1", "6");
    await page.fill("#export-frame-margin-1", "24");
    await page.fill("#export-frame-radius-1", "20");
    await page.check("#export-frame-shadow-1");
    await page.waitForTimeout(100);
  });

  // ── 2. Frame 2: inner band, SMALLER margin than Frame 1 is wrong on
  //     purpose here — we want frame 2 nested INSIDE frame 1, i.e. a
  //     LARGER margin, so both bands are visible as concentric rings. Also
  //     exercise the ring pool's second slot and a different shadow state
  //     (off) so both drop-shadow branches (on/off) run across the pool. ─
  await step("configure Frame 2 (nested inner band, margin 56, shadow off)", async () => {
    await page.check("#export-frame-enabled-2");
    await page.fill("#export-frame-thickness-2", "10");
    await page.fill("#export-frame-color-2", "#e63946");
    await page.fill("#export-frame-padding-2", "4");
    await page.fill("#export-frame-margin-2", "56");
    await page.fill("#export-frame-radius-2", "12");
    // Leave shadow-2 unchecked (default) — exercises the shadow:false
    // branch (filter: "none") alongside Frame 1's shadow:true branch.
    await page.waitForTimeout(100);
  });

  // ── 3. Outside-frame treatment: "white" (box-shadow-spread path). ──────
  await step("set outside-frame treatment to white", async () => {
    await page.selectOption("#frame-outside-mode", "white");
    await page.fill("#frame-outside-color", "#f1faee");
    await page.waitForTimeout(100);
  });

  // ── 4. Outside-frame treatment: "blur" (backdrop-filter + SVG mask
  //     path) — scrub the blur radius too. ────────────────────────────────
  await step("set outside-frame treatment to blur and scrub the radius", async () => {
    await page.selectOption("#frame-outside-mode", "blur");
    await page.fill("#frame-outside-blur", "14");
    await page.waitForTimeout(100);
    await page.fill("#frame-outside-blur", "30");
    await page.waitForTimeout(100);
  });

  // ── 5. Trigger the ResizeObserver-driven recompute of the outside
  //     treatment (applyOutside() re-run with no arguments, reading
  //     lastFrames/lastOutside — distinct call path from update()). ──────
  await step("resize the viewport to trigger the ResizeObserver recompute", async () => {
    const original = page.viewportSize();
    await page.setViewportSize({ width: 1050, height: 720 });
    await page.waitForTimeout(200);
    await page.setViewportSize(original || { width: 1280, height: 800 });
    await page.waitForTimeout(200);
  });

  // ── 6. Frame 1 to thickness 0 while still enabled: it draws no ring but
  //     (being the smaller-margin enabled element depends on current
  //     values) still participates in outermostEnabledFrame's boundary
  //     calc. Exercises the "enabled but thickness===0 → no ring" skip
  //     branch inside update()'s forEach. ─────────────────────────────────
  await step("set Frame 1 thickness to 0 (enabled, but draws no band)", async () => {
    await page.fill("#export-frame-thickness-1", "0");
    await page.waitForTimeout(100);
  });

  await step("restore Frame 1 thickness", async () => {
    await page.fill("#export-frame-thickness-1", "18");
    await page.waitForTimeout(100);
  });

  // ── 7. Outside treatment back to "none" (hides both outside layers). ──
  await step("set outside-frame treatment back to none", async () => {
    await page.selectOption("#frame-outside-mode", "none");
    await page.waitForTimeout(100);
  });

  // ── 8. Disable Frame 2, leaving only Frame 1 — pool ring for slot 2
  //     gets hidden (not removed), exercising the "hide leftover pool
  //     rings" tail of update(). ─────────────────────────────────────────
  await step("disable Frame 2", async () => {
    await page.uncheck("#export-frame-enabled-2");
    await page.waitForTimeout(100);
  });

  // ── 9. Bottom fade (js/map-fade.js) — enabled/height/intensity/color,
  //     composing with the frame overlay above it in z-order. ────────────
  await step("enable bottom fade with a custom intensity/color", async () => {
    await page.check("#bottom-fade-enabled");
    await page.fill("#bottom-fade-height", "40");
    await page.fill("#bottom-fade-intensity", "70");
    await page.fill("#bottom-fade-color", "#1d3557");
    await page.waitForTimeout(100);
  });

  await step("disable bottom fade", async () => {
    await page.uncheck("#bottom-fade-enabled");
    await page.waitForTimeout(100);
  });

  // ── 10. Leave both frames disabled and outside=none so a later scenario
  //     (or a human re-running this suite) doesn't inherit a busy canvas. ─
  await step("disable both frames for a clean handoff", async () => {
    await page.uncheck("#export-frame-enabled-1");
    await page.uncheck("#export-frame-enabled-2");
    await page.waitForTimeout(100);
  });
}
