// test/coverage/scenarios/20-map-title-drag.mjs — deep drive of
// js/map-title.js's interaction paths (~49% covered per the coverage-batch
// spec): the Pointer Events drag (down → move × N → up, commit + normalized
// offset), the keyboard-nudge path (Arrow / Shift+Arrow), and the
// resize/reproject path (export-size preset change → recenterX() + a real
// MapLibre "resize" event, and a raw viewport resize via the
// ResizeObserver wired in js/map-viewport.js).
//
// Every step is its own try/catch per test/coverage/run.mjs's contract.

const ON_MAP_TITLE_KEY = "city-pin-map.export-on-map-title.v1";
const SIDE_TAB_KEY = "city-pin-map.side-tab.v1";
const EXPORT_FORMAT_KEY = "city-pin-map.export-format.v1";
const OVERLAY_SELECTOR = "#export-on-map-title-overlay";

async function step(label, fn) {
  try {
    await fn();
    console.log(`    ✔ ${label}`);
  } catch (err) {
    console.log(`    ✘ ${label} —`, err?.message || err);
  }
}

export async function run(page) {
  // ── 1. Seed a two-line title (so the overlay is visible from first
  //     paint) + reload into the Design tab. ─────────────────────────────
  await step("seed a two-line on-map title into localStorage and reload", async () => {
    await page.evaluate(
      ({ titleKey, sideTabKey, exportFormatKey }) => {
        const title = {
          nx: 0.5,
          ny: 0.85,
          lines: [
            {
              text: "City Pin Map",
              font: 'Georgia, "Times New Roman", serif',
              bold: true,
              italic: false,
              color: "#1f2937",
              size: 28,
            },
            {
              text: "Coverage drag/nudge run",
              font: "Helvetica, Arial, sans-serif",
              bold: false,
              italic: true,
              color: "#334155",
              size: 16,
            },
          ],
        };
        localStorage.setItem(titleKey, JSON.stringify(title));
        localStorage.setItem(sideTabKey, "design");
        // Start from a known preset so the later preset-switch step
        // definitely fires a `change` event (different value).
        localStorage.setItem(exportFormatKey, "current");
      },
      { titleKey: ON_MAP_TITLE_KEY, sideTabKey: SIDE_TAB_KEY, exportFormatKey: EXPORT_FORMAT_KEY }
    );
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector(`${OVERLAY_SELECTOR}:not([hidden])`, { timeout: 15000 });
  });

  // ── 2. Pointer drag: down → move × N → up. Real Playwright mouse actions
  //     synthesize genuine (trusted) pointer events in Chromium, so this
  //     exercises setPointerCapture, the live pixel-driven move, and the
  //     commit-to-normalized-fraction + onAnchorChange call on release. ───
  await step("drag the on-map title overlay via pointer events", async () => {
    const box = await page.locator(OVERLAY_SELECTOR).boundingBox();
    if (!box) throw new Error("overlay has no bounding box (hidden?)");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Several incremental moves so onPointerMove's pixel-driven transform
    // runs more than once, not just a single jump.
    await page.mouse.move(startX + 15, startY - 10, { steps: 5 });
    await page.mouse.move(startX + 40, startY - 35, { steps: 5 });
    await page.mouse.move(startX + 70, startY - 60, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  });

  // ── 3. Keyboard nudge: focus the overlay (role=textbox, tabIndex 0), then
  //     Arrow keys (1px step) and Shift+Arrow (10px step). ────────────────
  await step("focus the overlay and nudge it with arrow keys", async () => {
    const overlay = page.locator(OVERLAY_SELECTOR);
    await overlay.focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(50);
  });

  await step("shift+arrow nudge (10px step branch)", async () => {
    const overlay = page.locator(OVERLAY_SELECTOR);
    await overlay.focus();
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(50);
  });

  await step("an unrelated key while focused passes through harmlessly", async () => {
    const overlay = page.locator(OVERLAY_SELECTOR);
    await overlay.focus();
    await page.keyboard.press("Tab");
  });

  // ── 4. Export-size preset switch → recenterX() + a real MapLibre
  //     "resize" event (js/map-viewport.js calls map.resize() after
  //     letterboxing #map), which drives map-title.js's reproject(). ─────
  await step("switch export-size preset to trigger recenterX + reproject", async () => {
    await page.selectOption("#export-format", "a4-portrait");
    await page.waitForTimeout(250);
  });

  await step("switch to a second preset (portrait→landscape re-center)", async () => {
    await page.selectOption("#export-format", "a4-landscape");
    await page.waitForTimeout(250);
  });

  // ── 5. Raw viewport resize: js/map-viewport.js's ResizeObserver on
  //     `.app-map` calls apply() → map.resize() → another "resize" event,
  //     independent of the preset-switch path above. ─────────────────────
  await step("resize the browser viewport to trigger the ResizeObserver path", async () => {
    const original = page.viewportSize();
    await page.setViewportSize({ width: 1100, height: 750 });
    await page.waitForTimeout(200);
    await page.setViewportSize(original || { width: 1280, height: 800 });
    await page.waitForTimeout(200);
  });

  // Restore "current view" so a later scenario doesn't inherit a
  // letterboxed map (mirrors 00-boot-and-broad.mjs's own cleanup).
  await step("restore export-size preset to current view", async () => {
    await page.selectOption("#export-format", "current");
    await page.waitForTimeout(150);
  });
}
