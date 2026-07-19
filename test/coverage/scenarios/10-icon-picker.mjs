// test/coverage/scenarios/10-icon-picker.mjs — deep drive of js/icon-picker.js
// (the biggest coverage gap: ~4% covered / ~451 uncovered lines per the
// coverage-batch spec). Exercises the modal grid view (search/filter,
// category collapse, tile select/reselect), the full add-icon sub-view
// (name/url/artist fields, tintable vs non-tintable SVG, the sanitizer
// rejection path, the empty-textarea reset path), the drag-and-drop file
// path (wrong-type reject, unreadable-file catch, valid-file success), and
// the trash-button cascade-clear delete flow — see js/icon-picker.js,
// js/icons.js, js/svg-ingest.js, js/user-icons.js for the real wiring this
// mirrors.
//
// Every step is its own try/catch per test/coverage/run.mjs's contract.
//
// IMPORTANT: unlike 00-boot-and-broad.mjs's seeded pin (which is assigned to
// a group from the very first paint), the appearance tile for a GROUPED pin
// renders `disabled` (js/pin-list.js's buildAppearanceTile: "For grouped
// pins the whole composition is passive") — clicking it is a no-op, which is
// almost certainly why the icon-picker modal barely got exercised before.
// This scenario seeds its OWN dedicated, UNGROUPED pin so the tile is a live
// button with a click listener wired to openIconPicker().

const PINS_KEY = "city-pin-map.pins.v1";
const GROUPS_KEY = "city-pin-map.groups.v1";
const SIDE_TAB_KEY = "city-pin-map.side-tab.v1";

const PIN_ID = "coverage-icon-pin";

const TINTABLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>';

const MULTICOLOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path d="M2 2h10v10H2z" fill="#ff0000"/>' +
  '<path d="M12 12h10v10H12z" fill="#0000ff"/>' +
  "</svg>";

const UNSAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

async function step(label, fn) {
  try {
    await fn();
    console.log(`    ✔ ${label}`);
  } catch (err) {
    console.log(`    ✘ ${label} —`, err?.message || err);
  }
}

// Dispatches a synthetic drag/drop event on the drop-zone with a fake
// dataTransfer object. The real DataTransfer/File constructors work fine in
// Chromium, but icon-picker.js's drop handler only ever reads
// `e.dataTransfer.files[0].{type,name,text()}` — so a plain object plugged
// onto a plain Event does everything a real DragEvent would, including the
// "file became unreadable" catch branch (a real File can't easily be made
// to reject .text(), a fake one can).
async function dispatchDrop(page, { type, name, text, throwOnText } = {}) {
  await page.evaluate(
    async ({ type, name, text, throwOnText }) => {
      const dropZone = document.querySelector(".icon-picker-modal__drop-zone");
      if (!dropZone) throw new Error("drop zone not found");
      const fakeFile = {
        type: type ?? "",
        name: name ?? "",
        text: () =>
          throwOnText
            ? Promise.reject(new Error("simulated unreadable file"))
            : Promise.resolve(text ?? ""),
      };
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      ev.dataTransfer = { files: [fakeFile] };
      dropZone.dispatchEvent(ev);
      // The handler is async (awaits file.text()); give it a beat.
      await new Promise((r) => setTimeout(r, 150));
    },
    { type, name, text, throwOnText }
  );
}

export async function run(page) {
  // ── 1. Seed one dedicated, ungrouped pin + reload straight into Pins ───
  await step("seed an ungrouped pin into localStorage and reload", async () => {
    await page.evaluate(
      ({ pinsKey, groupsKey, sideTabKey, pinId }) => {
        const pins = [
          {
            id: pinId,
            name: "Reykjavik, Iceland",
            lat: 64.1466,
            lon: -21.9426,
            color: "#e63946",
            group: null,
            icon: null,
            createdAt: Date.now(),
          },
        ];
        localStorage.setItem(pinsKey, JSON.stringify(pins));
        localStorage.setItem(groupsKey, JSON.stringify([]));
        localStorage.setItem(sideTabKey, "pins");
      },
      { pinsKey: PINS_KEY, groupsKey: GROUPS_KEY, sideTabKey: SIDE_TAB_KEY, pinId: PIN_ID }
    );
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector(`.pin-list__row[data-pin-id="${PIN_ID}"]`, { timeout: 15000 });
  });

  const tile = () => page.locator(`.pin-list__row[data-pin-id="${PIN_ID}"] .pin-list__tile`);

  // ── 2. Open the modal (grid view) ───────────────────────────────────────
  await step("open the icon picker modal", async () => {
    await tile().click();
    await page.waitForSelector(".icon-picker-modal", { timeout: 5000 });
  });

  // ── 3. Search/filter: a match (built-in "Circle" survives, others don't
  //     — exercises the per-category collapse branch), then a zero-match
  //     query (every category collapses, "user" still renders so +Add stays
  //     reachable). ────────────────────────────────────────────────────────
  await step("search for a matching term", async () => {
    await page.fill(".icon-picker-modal__search-input", "circ");
    await page.waitForTimeout(100);
  });

  await step("search for a zero-match term", async () => {
    await page.fill(".icon-picker-modal__search-input", "zzz-nothing-matches-zzz");
    await page.waitForTimeout(100);
  });

  await step("clear the search", async () => {
    await page.fill(".icon-picker-modal__search-input", "");
    await page.waitForTimeout(100);
  });

  // ── 4. Select the built-in icon (already-effective → exercises the
  //     "select an unselected icon" branch, then closes the modal). ───────
  await step("select the built-in circle icon", async () => {
    const builtin = page.locator('.icon-picker-modal__tile[title="Circle"]').first();
    await builtin.click();
    await page.waitForSelector(".icon-picker-modal", { state: "detached", timeout: 5000 });
  });

  // ── 5. Reopen, select the SAME icon again (already selected → exercises
  //     the "isSelected" skip-update branch, still closes). ───────────────
  await step("reopen and re-select the same (already-selected) icon", async () => {
    await tile().click();
    await page.waitForSelector(".icon-picker-modal", { timeout: 5000 });
    const builtin = page.locator('.icon-picker-modal__tile[title="Circle"]').first();
    await builtin.click();
    await page.waitForSelector(".icon-picker-modal", { state: "detached", timeout: 5000 });
  });

  // ── 6. Reopen, go to add-icon sub-view via the "+ Add" tile ────────────
  await step("reopen picker and open the add-icon sub-view", async () => {
    await tile().click();
    await page.waitForSelector(".icon-picker-modal", { timeout: 5000 });
    await page.click(".icon-picker-modal__add-tile");
    await page.waitForSelector(".icon-picker-modal__sub", { timeout: 5000 });
  });

  // ── 7. Unsafe SVG → sanitizer rejection + error-feedback path ──────────
  await step("paste an unsafe SVG (script tag) and see the sanitizer reject it", async () => {
    await page.locator(".icon-picker-modal__sub-body textarea").fill(UNSAFE_SVG);
    await page.waitForTimeout(150);
    const errorText = await page.locator(".icon-picker-modal__error").textContent();
    if (!errorText || !errorText.trim()) {
      throw new Error("expected sanitizer error text, got none");
    }
  });

  // ── 8. Clear the textarea → exercises runIngest's "empty" reset branch ─
  await step("clear the textarea back to empty", async () => {
    await page.locator(".icon-picker-modal__sub-body textarea").fill("");
    await page.waitForTimeout(100);
  });

  // ── 9. Valid TINTABLE (single-fill) SVG, full form, add it ─────────────
  //
  // NOTE on field indices: showAddSubView's SVG-content wrapper (dropzone +
  // textarea) ALSO carries the "icon-picker-modal__field" class (it's a
  // hand-built div, not makeField()'s helper, but same className) — so the
  // `.icon-picker-modal__field` locator order is [0]=name, [1]=svg wrapper
  // (no <input> inside it), [2]=source URL, [3]=artist name, [4]=tintable
  // radio group. Indexing straight through 1/2 (as if the svg wrapper
  // weren't there) times out waiting for a non-existent <input>.
  await step("fill name + tintable SVG + attribution, then add it", async () => {
    const fields = page.locator(".icon-picker-modal__field");
    await fields.nth(0).locator("input").fill("Coverage Tintable Icon");
    await page.locator(".icon-picker-modal__sub-body textarea").fill(TINTABLE_SVG);
    await page.waitForTimeout(150);
    // Source URL + artist name (both optional metadata fields).
    await fields.nth(2).locator("input").fill("https://example.com/coverage-icon");
    await fields.nth(3).locator("input").fill("Coverage Artist");
    await page.click('.icon-picker-modal__actions button:has-text("Add to my icons")');
    await page.waitForTimeout(150);
  });

  // ── 10. Reopen the add sub-view, add a NON-tintable (multicolor) SVG ───
  await step("add a second, non-tintable (multicolor) icon", async () => {
    await page.click(".icon-picker-modal__add-tile");
    await page.waitForSelector(".icon-picker-modal__sub", { timeout: 5000 });
    const fields = page.locator(".icon-picker-modal__field");
    await fields.nth(0).locator("input").fill("Coverage Multicolor Icon");
    await page.locator(".icon-picker-modal__sub-body textarea").fill(MULTICOLOR_SVG);
    await page.waitForTimeout(150);
    // Explicitly pick "Use as-is" (non-tintable) via the radio group, even
    // though the heuristic should already suggest it for 2 distinct fills.
    await page.check('input[name="tintable"][value="false"]');
    await page.click('.icon-picker-modal__actions button:has-text("Add to my icons")');
    await page.waitForTimeout(150);
  });

  // ── 11. Drag-and-drop file path: wrong type/extension → reject ─────────
  await step("open add sub-view and drop a non-svg file (reject path)", async () => {
    await page.click(".icon-picker-modal__add-tile");
    await page.waitForSelector(".icon-picker-modal__sub", { timeout: 5000 });
    // dragover/dragleave toggle the drop-zone's active class — no
    // dataTransfer needed for those handlers.
    await page.dispatchEvent(".icon-picker-modal__drop-zone", "dragover");
    await page.dispatchEvent(".icon-picker-modal__drop-zone", "dragleave");
    await dispatchDrop(page, { type: "text/plain", name: "notes.txt", text: "hello" });
    const errorText = await page.locator(".icon-picker-modal__error").textContent();
    if (!errorText || !/\.svg/i.test(errorText)) {
      throw new Error("expected 'drop an .svg file' error, got: " + errorText);
    }
  });

  // ── 12. Drag-and-drop: file becomes unreadable → catch branch ──────────
  await step("drop a file whose .text() rejects (unreadable-file catch path)", async () => {
    await dispatchDrop(page, { type: "image/svg+xml", name: "broken.svg", throwOnText: true });
    const errorText = await page.locator(".icon-picker-modal__error").textContent();
    if (!errorText || !/could not read/i.test(errorText)) {
      throw new Error("expected 'could not read that file' error, got: " + errorText);
    }
  });

  // ── 13. Drag-and-drop: valid .svg file → success path fills textarea ───
  await step("drop a valid .svg file (success path) and add it", async () => {
    await dispatchDrop(page, { type: "image/svg+xml", name: "coverage-drop.svg", text: TINTABLE_SVG });
    const fields = page.locator(".icon-picker-modal__field");
    await fields.nth(0).locator("input").fill("Coverage Dropped Icon");
    await page.waitForTimeout(150);
    await page.click('.icon-picker-modal__actions button:has-text("Add to my icons")');
    await page.waitForTimeout(150);
  });

  // ── 14. Cancel out of a fresh add-sub-view (Back button / Cancel path) ─
  await step("open add sub-view once more and Cancel back to grid", async () => {
    await page.click(".icon-picker-modal__add-tile");
    await page.waitForSelector(".icon-picker-modal__sub", { timeout: 5000 });
    await page.click('.icon-picker-modal__actions button:has-text("Cancel")');
    await page.waitForSelector(".icon-picker-modal__sub", { state: "detached", timeout: 5000 });
  });

  // ── 15. Trash-delete one of the user icons we just added → cascade-clear
  //     (pin.icon → null) path in the trash button's click handler. Accept
  //     the confirm() dialog it opens. ────────────────────────────────────
  await step("delete a user icon via its trash button (cascade-clear)", async () => {
    page.once("dialog", (dialog) => dialog.accept());
    // The trash button is `display: none` until its parent tile is
    // `:hover`ed (css/styles.css) — it has literally no box to click while
    // hidden, so even `force: true` can't compute a click point. Hover the
    // tile itself first (real CSS :hover, not a synthetic bypass) so the
    // trash button actually renders before we click it.
    const tile = page.locator('.icon-picker-modal__tile[title^="Coverage Tintable Icon"]');
    await tile.hover();
    const trash = page.locator('.icon-picker-modal__tile-trash[aria-label*="Coverage Tintable Icon"]');
    await trash.click();
    await page.waitForTimeout(150);
  });

  // ── 16. Close via clicking the modal's header × button ─────────────────
  await step("close via the header close (×) button", async () => {
    await page.click(".icon-picker-modal__close");
    await page.waitForSelector(".icon-picker-modal", { state: "detached", timeout: 5000 });
  });

  // ── 17. Reopen and close via click-outside (overlay backdrop) ──────────
  await step("reopen and close by clicking the overlay backdrop", async () => {
    await tile().click();
    await page.waitForSelector(".icon-picker-modal", { timeout: 5000 });
    await page.click(".icon-picker-overlay", { position: { x: 2, y: 2 } });
    await page.waitForSelector(".icon-picker-modal", { state: "detached", timeout: 5000 });
  });

  // ── 18. Reopen and close via Escape ─────────────────────────────────────
  await step("reopen and close via Escape", async () => {
    await tile().click();
    await page.waitForSelector(".icon-picker-modal", { timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".icon-picker-modal", { state: "detached", timeout: 5000 });
  });
}
