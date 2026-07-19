// test/coverage/scenarios/00-boot-and-broad.mjs — FIRST broad interaction
// driver. Establishes a baseline slice across most of the browser-only
// modules (app.js, side-tabs.js, map.js, pin-list.js, group-panel.js,
// icon-picker.js, settings-panel.js, style-picker.js, map-frame.js,
// map-fade.js, map-title.js, map-viewport.js, export.js). Later scenario
// files can go deeper on any one of these; this one is intentionally wide
// and shallow.
//
// Every step is its own try/catch (per test/coverage/run.mjs's contract):
// one interaction going sideways (a selector that moved, a network-gated
// basemap swap failing in this sandbox) must not stop the rest of the
// scenario from running and contributing coverage.
//
// `page` arrives already navigated to the booted app with JS coverage
// recording (resetOnNavigation: false, so this scenario's own
// localStorage-seed-and-reload step keeps accruing to the same profile).

const PINS_KEY = "city-pin-map.pins.v1";
const GROUPS_KEY = "city-pin-map.groups.v1";
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
  // ── 1. Side-tab switching (side-tabs.js) ────────────────────────────
  await step("switch to Pins tab", async () => {
    await page.click("#side-tab-pins");
    await page.waitForSelector("#side-panel-pins:not([hidden])", { timeout: 5000 });
  });

  await step("switch to Groups tab", async () => {
    await page.click("#side-tab-groups");
    await page.waitForSelector("#side-panel-groups:not([hidden])", { timeout: 5000 });
  });

  await step("keyboard nav: Home from Groups tab lands on Design", async () => {
    await page.focus("#side-tab-groups");
    await page.keyboard.press("Home");
    await page.waitForSelector("#side-panel-design:not([hidden])", { timeout: 5000 });
  });

  await step("keyboard nav: ArrowRight moves to Pins", async () => {
    await page.keyboard.press("ArrowRight");
    // side-tabs.js roves tabindex/focus but a fresh click confirms the
    // panel actually followed, independent of exactly which element has
    // DOM focus in a headless context.
    await page.click("#side-tab-pins");
    await page.waitForSelector("#side-panel-pins:not([hidden])", { timeout: 5000 });
  });

  // ── 2. Seed pins + a group via localStorage, then reload ───────────
  // Bypasses Nominatim entirely (no network geocoding in this sandbox) —
  // matches the app's own real pin/group shape (js/pins.js, js/groups.js,
  // CLAUDE.md's "Pin data model"), so markers render on the very first
  // paint after reload exactly like a real restored session would.
  await step("seed pins + group into localStorage and reload", async () => {
    await page.evaluate(
      ({ pinsKey, groupsKey, sideTabKey }) => {
        const now = Date.now();
        const groupId = "coverage-group-1";
        const groups = [
          { id: groupId, name: "Coverage Group", color: "#2a9d8f", createdAt: now },
        ];
        const pins = [
          {
            id: "coverage-pin-1",
            name: "Paris, France",
            lat: 48.8566,
            lon: 2.3522,
            color: "#e63946",
            group: groupId,
            icon: null,
            createdAt: now,
          },
          {
            id: "coverage-pin-2",
            name: "Tokyo, Japan",
            lat: 35.6762,
            lon: 139.6503,
            color: "#457b9d",
            group: null,
            icon: null,
            createdAt: now + 1,
          },
          {
            id: "coverage-pin-3",
            name: "Nairobi, Kenya",
            lat: -1.2921,
            lon: 36.8219,
            color: "#f4a261",
            group: null,
            icon: null,
            createdAt: now + 2,
          },
        ];
        localStorage.setItem(pinsKey, JSON.stringify(pins));
        localStorage.setItem(groupsKey, JSON.stringify(groups));
        // Keep the Design tab active across the reload so the frame/fade/
        // title steps below don't have to fight the panel's [hidden]
        // attribute (a hidden panel's controls aren't clickable).
        localStorage.setItem(sideTabKey, "design");
      },
      { pinsKey: PINS_KEY, groupsKey: GROUPS_KEY, sideTabKey: SIDE_TAB_KEY }
    );
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("#side-tab-design", { timeout: 20000 });
    await page.waitForSelector('.pin-list__row[data-pin-id="coverage-pin-1"]', {
      timeout: 10000,
    });
  });

  // ── 3. Route toggle (map.js renderRoute) ────────────────────────────
  await step("toggle route on and off", async () => {
    await page.check("#route-toggle");
    await page.waitForTimeout(200);
    await page.uncheck("#route-toggle");
  });

  // ── 4. Frame 1 + outside-frame white (map-frame.js) ─────────────────
  await step("enable Frame 1 with a visible band", async () => {
    await page.check("#export-frame-enabled-1");
    await page.fill("#export-frame-thickness-1", "24");
    await page.fill("#export-frame-color-1", "#1d3557");
    await page.fill("#export-frame-padding-1", "8");
    await page.fill("#export-frame-margin-1", "12");
    await page.fill("#export-frame-radius-1", "16");
    await page.check("#export-frame-shadow-1");
  });

  await step("set outside-frame treatment to white", async () => {
    await page.selectOption("#frame-outside-mode", "white");
    await page.fill("#frame-outside-color", "#ffffff");
  });

  // ── 5. Bottom fade (map-fade.js) ────────────────────────────────────
  await step("enable bottom fade", async () => {
    await page.check("#bottom-fade-enabled");
    await page.fill("#bottom-fade-height", "35");
    await page.fill("#bottom-fade-intensity", "60");
    await page.fill("#bottom-fade-color", "#ffffff");
  });

  // ── 6. Two-line on-map title (map-title.js) ─────────────────────────
  await step("add a second title line and fill both in", async () => {
    const firstLine = page.locator("#otm-lines .otm-line-row").first();
    await firstLine.locator(".otm-line-text").fill("City Pin Map");
    await page.click("#otm-add-line");
    const secondLine = page.locator("#otm-lines .otm-line-row").nth(1);
    await secondLine.locator(".otm-line-text").fill("Coverage baseline run");
    await secondLine.locator(".otm-format-toggle").first().click(); // bold
  });

  // ── 7. Export-size preset (map-viewport.js letterbox preview) ──────
  await step("switch export-size preset to A4 portrait", async () => {
    await page.selectOption("#export-format", "a4-portrait");
    await page.waitForTimeout(200);
  });

  // ── 8. Export PNG (export.js) ────────────────────────────────────────
  await step("trigger Export PNG and wait for it to finish", async () => {
    await page.click("#export-png");
    await page
      .waitForFunction(
        () => document.getElementById("export-png")?.disabled === false,
        { timeout: 20000 }
      )
      .catch(() => {
        // Belt-and-suspenders: even if the disabled-flag poll times out
        // (e.g. a slow WebGL readback in this sandbox), give the export
        // pipeline a fixed grace window so its own finally{} block still
        // has a chance to run before the scenario moves on.
      });
    await page.waitForTimeout(500);
  });

  // Restore "current view" so a later scenario doesn't inherit a
  // letterboxed map.
  await step("restore export-size preset to current view", async () => {
    await page.selectOption("#export-format", "current");
  });

  // ── 9. Pin-list interactions: color, group, rename (pin-list.js) ───
  await step("switch to Pins tab for row interactions", async () => {
    await page.click("#side-tab-pins");
    await page.waitForSelector("#side-panel-pins:not([hidden])", { timeout: 5000 });
  });

  await step("recolor a pin via its native color swatch", async () => {
    const swatch = page.locator(
      '.pin-list__row[data-pin-id="coverage-pin-2"] .pin-list__color-swatch'
    );
    await swatch.evaluate((el) => {
      el.value = "#22223b";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  await step("assign a pin to the coverage group via its selector", async () => {
    const select = page.locator(
      '.pin-list__row[data-pin-id="coverage-pin-3"] .pin-list__group-select'
    );
    await select.selectOption("coverage-group-1");
  });

  await step("rename a pin inline", async () => {
    const row = page.locator('.pin-list__row[data-pin-id="coverage-pin-2"]');
    await row.locator(".edit-pin").click();
    const input = row.locator(".pin-list__rename-input");
    await input.fill("Tokyo (renamed)");
    await input.press("Enter");
  });

  // ── 10. Icon picker modal + add-icon sub-view (icon-picker.js) ─────
  await step("open icon picker, add a custom SVG icon, select it", async () => {
    const tile = page.locator(
      '.pin-list__row[data-pin-id="coverage-pin-1"] .pin-list__tile'
    );
    await tile.click();
    await page.waitForSelector(".icon-picker-modal", { timeout: 5000 });

    // Jump straight to the add-icon sub-view via the "+ Add" tile in the
    // "My icons" category (present even with zero user icons so far).
    await page.click(".icon-picker-modal__add-tile");
    await page.waitForSelector(".icon-picker-modal__sub", { timeout: 5000 });

    const fields = page.locator(".icon-picker-modal__field");
    await fields.nth(0).locator("input").fill("Coverage Test Icon");
    await page
      .locator(".icon-picker-modal__sub-body textarea")
      .fill(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>'
      );
    // Ingestion runs on the textarea's `input` event; give the preview a
    // beat to update and enable the Add button.
    await page.waitForTimeout(150);
    await page.click('.icon-picker-modal__actions button:has-text("Add to my icons")');

    // Back on the grid view — pick the freshly-added icon under "My icons"
    // if it rendered in time; either way, close the modal afterward.
    await page.waitForTimeout(150);
  });

  await step("close the icon picker", async () => {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".icon-picker-modal", { state: "detached", timeout: 5000 });
  });

  // ── 11. Settings modal (settings-panel.js) ──────────────────────────
  await step("open settings, enter a Stadia key, toggle reveal, close", async () => {
    await page.click("#open-settings");
    await page.waitForSelector("#settings-modal:not([hidden])", { timeout: 5000 });
    const input = page.locator('[data-key-input="stadia"]');
    await input.fill("coverage-test-fake-key");
    await page.click('[data-reveal-for="stadia"]');
    await input.blur();
    await page.waitForTimeout(100);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#settings-modal:not([hidden])", {
      state: "detached",
      timeout: 5000,
    }).catch(async () => {
      // The modal toggles [hidden] rather than detaching — fall back to
      // asserting that attribute directly.
      await page.waitForSelector("#settings-modal[hidden]", { timeout: 5000 });
    });
  });

  // ── 12. Style picker popover (style-picker.js) ──────────────────────
  await step("open style picker, search, and swap to a raster style", async () => {
    await page.click("#map-style-trigger");
    await page.waitForSelector("#map-style-popover:not([hidden])", { timeout: 5000 });
    await page.fill("#map-style-search", "topo");
    await page.waitForTimeout(200);
    const row = page.locator('.picker__row[data-style-id="topo"]');
    if (await row.count()) {
      await row.click();
    }
    // Give a real (possibly network-gated) style swap a moment to either
    // succeed or fail-and-revert via map.js's setStyleSafely — both paths
    // are worth exercising, and neither should throw here.
    await page.waitForTimeout(1500);
  });

  await step("swap back to the default vector style", async () => {
    await page.click("#map-style-trigger");
    await page.waitForSelector("#map-style-popover:not([hidden])", { timeout: 5000 });
    await page.fill("#map-style-search", "");
    const row = page.locator('.picker__row[data-style-id="osm"]');
    if (await row.count()) {
      await row.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(1000);
  });
}
