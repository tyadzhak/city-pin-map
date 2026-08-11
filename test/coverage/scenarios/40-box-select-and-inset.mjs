// test/coverage/scenarios/40-box-select-and-inset.mjs — drives two
// features together since both are pin/group spatial operations on the main
// map:
//
//   1. Shift+drag box-select → bulk group assign (js/map-select.js, new this
//      milestone). Covers: a multi-pin drag creating a NEW group (the
//      default-groups-empty branch), a single-pin drag assigning an EXISTING
//      group, a zero-pin drag (no panel — the selection just dissolves), and
//      Escape-to-cancel. Also spot-checks the cheap highlight cue
//      (.map-select-highlighted) while the popover is open, the rubber band's
//      lifecycle (painted mid-drag, gone after release), and — the riskiest
//      invariant of the whole feature — that the map does NOT pan during a
//      Shift+drag (see assertNoPan below for why a regression there would
//      corrupt selections silently rather than visibly).
//
//   2. A regression check for the "inset shows non-group pins" bug fix
//      (js/map-inset.js's shared pinsForInset() filter): a pin seeded right
//      next to a group's only member must NOT show up in the inset's own
//      label overlay just because it geographically falls inside the
//      group's fitted viewport — CLAUDE.md's known "no browser-coverage
//      scenario yet for map-inset.js" gap, extended here cheaply rather than
//      built from scratch.
//
// Seeds its OWN self-contained pins/groups via localStorage + reload (same
// pattern 20-map-title-drag.mjs / 30-map-frame-2.mjs use) rather than relying
// on whatever 00-boot-and-broad.mjs left behind, so this scenario's
// assertions don't depend on another file's step order. Five pins across
// three screen-space-separated clusters (Europe pair, a lone West-Africa
// control pin, a Pakistan pair) — chosen and verified (via an ad-hoc
// Playwright probe against this exact harness) to project WELL INSIDE the
// map container's own bounding box at the app's default zoom-2 world-view
// boot camera, which is narrower than the full ±180° world: an earlier
// attempt using real antipodal cities (Sydney, Buenos Aires) put their DOM
// labels dozens to hundreds of px outside #map's actual rect (still
// "visible" per .map-pin-labels' overflow:visible, but a shift+drag start
// point out there never reaches js/map-select.js's container-level listener
// at all, since the pointerdown target isn't a descendant of #map).
//
// Every step is its own try/catch per test/coverage/run.mjs's contract.

const PINS_KEY = "city-pin-map.pins.v1";
const GROUPS_KEY = "city-pin-map.groups.v1";
const SIDE_TAB_KEY = "city-pin-map.side-tab.v1";
const INSET_GROUP_ID = "coverage-inset-group";
const NEW_GROUP_LABEL = "+ New group…";

async function step(label, fn) {
  try {
    await fn();
    console.log(`    ✔ ${label}`);
  } catch (err) {
    console.log(`    ✘ ${label} —`, err?.message || err);
  }
}

// Bounding box of a pin's rendered DOM label (js/map-labels.js), padded by
// `margin` CSS px on every side and clamped to stay INSIDE the map
// container's own rect. The label sits BELOW its pin's actual marker (a
// fixed ems offset), so the margin needs to be generous enough to also cover
// the marker itself, not just the label text — 60px comfortably covers the
// ~32px icon plus its ~15-20px label gap at this app's default pin style.
//
// The clamp matters because `.map-pin-labels` renders with overflow:visible
// (so labels near the map's own edge aren't clipped) — a pin whose projected
// position sits OUTSIDE the map container (a real case hit while authoring
// this scenario: an antipodal test pin's label landed >300px past #map's
// right edge) would otherwise produce a drag START point that never reaches
// #map at all, so js/map-select.js's container-level pointerdown listener
// never fires and the drag silently does nothing.
async function paddedPinBox(page, pinId, margin = 60) {
  const loc = page.locator(`.map-pin-labels__label[data-pin-id="${pinId}"]`);
  await loc.waitFor({ state: "visible", timeout: 8000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no bounding box for pin ${pinId} (label hidden?)`);
  const mapBox = await page.locator("#map").boundingBox();
  if (!mapBox) throw new Error("map container has no bounding box");
  const clampX = (x) => Math.min(Math.max(x, mapBox.x + 2), mapBox.x + mapBox.width - 2);
  const clampY = (y) => Math.min(Math.max(y, mapBox.y + 2), mapBox.y + mapBox.height - 2);
  return {
    left: clampX(box.x - margin),
    top: clampY(box.y - margin),
    right: clampX(box.x + box.width + margin),
    bottom: clampY(box.y + box.height + margin),
  };
}

function unionRect(boxes) {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

// Real Shift+drag via Playwright mouse actions (dispatches genuine trusted
// pointer events in Chromium, same technique 20-map-title-drag.mjs uses for
// js/map-title.js's Pointer-Events drag) — exercises js/map-select.js's
// capture-phase pointerdown interception, the rubber-band paint on
// pointermove, and the release-time pinsInRect() selection.
// `onMidDrag`, when given, runs while the button is still down (after the
// pointer has moved far enough to paint the rubber band) so a caller can
// assert on mid-gesture DOM.
async function shiftDrag(page, rect, onMidDrag) {
  await page.keyboard.down("Shift");
  await page.mouse.move(rect.left, rect.top);
  await page.mouse.down();
  const midX = (rect.left + rect.right) / 2;
  const midY = (rect.top + rect.bottom) / 2;
  await page.mouse.move(midX, midY, { steps: 5 });
  if (onMidDrag) await onMidDrag();
  await page.mouse.move(rect.right, rect.bottom, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

// The single riskiest invariant of this feature: a Shift+drag must NOT pan the
// map. js/map-select.js disables MapLibre's boxZoom (its usual Shift-drag
// claimant) and relies on preventDefault()ing the pointerdown to suppress the
// compatibility mousedown dragPan actually listens for — if that ever
// regresses, dragPan takes the gesture, the camera moves mid-drag, and the
// release-time map.project() of every pin resolves against a DIFFERENT camera
// than the rectangle was drawn in. That corrupts the selection SILENTLY (a
// plausible-looking popover with the wrong pins), so it needs its own
// assertion rather than being inferred from the selection assertions.
//
// A rendered pin label's on-screen box is the cheapest camera probe available:
// js/map-labels.js re-projects every label on every map move, so any pan shows
// up as a shifted box. Tolerance is 1px for sub-pixel layout rounding.
async function labelBox(page, pinId) {
  const box = await page.locator(`.map-pin-labels__label[data-pin-id="${pinId}"]`).boundingBox();
  if (!box) throw new Error(`no bounding box for pin ${pinId}`);
  return box;
}

function assertNoPan(before, after, label) {
  const dx = Math.abs(after.x - before.x);
  const dy = Math.abs(after.y - before.y);
  if (dx > 1 || dy > 1) {
    throw new Error(
      `${label}: the map panned during the shift+drag (label moved ${dx.toFixed(1)}x${dy.toFixed(1)}px) — dragPan claimed the gesture`
    );
  }
}

export async function run(page) {
  // ── 0. Seed pins across three well-separated clusters + one pre-existing
  //     group, then reload. ──────────────────────────────────────────────
  await step("seed box-select + inset coverage pins/groups and reload", async () => {
    await page.evaluate(
      ({ pinsKey, groupsKey, sideTabKey, insetGroupId }) => {
        const now = Date.now();
        const groups = [
          {
            id: insetGroupId,
            name: "Inset Coverage Group",
            color: "#2a9d8f",
            createdAt: now,
          },
        ];
        const pins = [
          // Europe pair (Berlin/Warsaw) — swept together by the first
          // box-select drag. Verified to project ~40-70px apart on screen.
          {
            id: "sel-a",
            name: "Select Pin A",
            lat: 52.52,
            lon: 13.405,
            color: "#e63946",
            group: null,
            icon: null,
            createdAt: now,
          },
          {
            id: "sel-b",
            name: "Select Pin B",
            lat: 52.2297,
            lon: 21.0122,
            color: "#457b9d",
            group: null,
            icon: null,
            createdAt: now + 1,
          },
          // Control pin (Dakar), ~200px+ from the Europe pair on screen —
          // proves selection is spatial (not "select all") and exercises
          // the existing-group assign path.
          {
            id: "sel-c",
            name: "Select Pin C",
            lat: 14.7167,
            lon: -17.4467,
            color: "#f4a261",
            group: null,
            icon: null,
            createdAt: now + 2,
          },
          // Karachi pair for the inset-filter regression check: ONE pin in
          // the seeded group, ONE pin geographically right next to it (their
          // DOM labels project ~1px apart) but deliberately left ungrouped.
          {
            id: "inset-grouped",
            name: "Inset Grouped Pin",
            lat: 24.8607,
            lon: 67.0011,
            color: "#2a9d8f",
            group: insetGroupId,
            icon: null,
            createdAt: now + 3,
          },
          {
            id: "inset-neighbor",
            name: "Inset Neighbor Pin",
            lat: 24.9,
            lon: 67.05,
            color: "#264653",
            group: null,
            icon: null,
            createdAt: now + 4,
          },
        ];
        localStorage.setItem(pinsKey, JSON.stringify(pins));
        localStorage.setItem(groupsKey, JSON.stringify(groups));
        localStorage.setItem(sideTabKey, "design");
      },
      { pinsKey: PINS_KEY, groupsKey: GROUPS_KEY, sideTabKey: SIDE_TAB_KEY, insetGroupId: INSET_GROUP_ID }
    );
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('.map-pin-labels__label[data-pin-id="sel-a"]', {
      timeout: 15000,
    });
  });

  // ── 1. Shift+drag over an EMPTY area of the map: zero pins inside means
  //     the selection just dissolves — no popover. ───────────────────────
  await step("shift+drag over empty map area shows no popover", async () => {
    const mapBox = await page.locator("#map").boundingBox();
    if (!mapBox) throw new Error("map container has no bounding box");
    // Purest no-pan probe: an empty-area drag has no pin/label under the
    // cursor at all, so nothing but js/map-select.js's own interception stands
    // between this gesture and MapLibre's dragPan.
    const cameraBefore = await labelBox(page, "sel-a");
    await shiftDrag(page, {
      left: mapBox.x + 15,
      top: mapBox.y + 15,
      right: mapBox.x + 70,
      bottom: mapBox.y + 70,
    });
    await page.waitForTimeout(200);
    const count = await page.locator(".map-select-panel").count();
    if (count !== 0) {
      throw new Error("a zero-pin box-select still opened the assign popover");
    }
    assertNoPan(cameraBefore, await labelBox(page, "sel-a"), "empty-area shift+drag");
  });

  // ── 2. Shift+drag around the Europe pair (sel-a + sel-b): opens the
  //     popover with "2 pins selected", the cheap highlight cue on both
  //     labels, and (no groups pre-selected) the "+ New group…" flow. ────
  await step("shift+drag selects two pins and shows the highlight cue", async () => {
    const boxA = await paddedPinBox(page, "sel-a");
    const boxB = await paddedPinBox(page, "sel-b");

    // Camera probe (see assertNoPan) + rubber-band lifecycle, both checked
    // around/inside this one real drag rather than in a separate step, so they
    // cost nothing extra.
    const cameraBefore = await labelBox(page, "sel-a");
    let rectMidDrag = 0;
    await shiftDrag(page, unionRect([boxA, boxB]), async () => {
      rectMidDrag = await page.locator(".map-select-rect").count();
    });
    await page.waitForSelector(".map-select-panel", { timeout: 5000 });

    if (rectMidDrag !== 1) {
      throw new Error(
        `expected exactly 1 painted .map-select-rect mid-drag, got ${rectMidDrag}`
      );
    }
    const rectAfter = await page.locator(".map-select-rect").count();
    if (rectAfter !== 0) {
      throw new Error(`the rubber band survived pointerup (${rectAfter} left in the DOM)`);
    }
    assertNoPan(cameraBefore, await labelBox(page, "sel-a"), "two-pin shift+drag");

    const countText = await page.locator(".map-select-panel__count").textContent();
    if (!countText || !countText.includes("2 pins selected")) {
      throw new Error(`expected "2 pins selected", got "${countText}"`);
    }
    const highlighted = await page
      .locator(".map-pin-labels__label.map-select-highlighted")
      .count();
    if (highlighted !== 2) {
      throw new Error(`expected 2 highlighted labels, got ${highlighted}`);
    }
  });

  await step("create a new group from the popover and assign both pins", async () => {
    await page.selectOption(".map-select-panel__select", { label: NEW_GROUP_LABEL });
    await page.locator(".map-select-panel__name").fill("Box Select Group");
    await page.click(".map-select-panel__assign");
    await page.waitForSelector(".map-select-panel", { state: "detached", timeout: 5000 });

    const groupA = await page
      .locator('.pin-list__row[data-pin-id="sel-a"] .pin-list__group-select')
      .inputValue();
    const groupB = await page
      .locator('.pin-list__row[data-pin-id="sel-b"] .pin-list__group-select')
      .inputValue();
    if (!groupA || groupA !== groupB) {
      throw new Error(
        `box-select did not assign a matching new group: sel-a=${groupA} sel-b=${groupB}`
      );
    }
    const groupC = await page
      .locator('.pin-list__row[data-pin-id="sel-c"] .pin-list__group-select')
      .inputValue();
    if (groupC) {
      throw new Error(`sel-c (outside the box) should still be ungrouped, got ${groupC}`);
    }
  });

  // ── 3. Shift+drag around the lone control pin: "1 pin selected", and this
  //     time pick an EXISTING group from the dropdown (now that one exists)
  //     instead of creating another. ─────────────────────────────────────
  await step("shift+drag selects one pin and assigns an existing group", async () => {
    const boxC = await paddedPinBox(page, "sel-c");
    await shiftDrag(page, boxC);
    await page.waitForSelector(".map-select-panel", { timeout: 5000 });

    const countText = await page.locator(".map-select-panel__count").textContent();
    if (!countText || !countText.includes("1 pin selected")) {
      throw new Error(`expected "1 pin selected", got "${countText}"`);
    }

    await page.selectOption(".map-select-panel__select", { label: "Box Select Group" });
    await page.click(".map-select-panel__assign");
    await page.waitForSelector(".map-select-panel", { state: "detached", timeout: 5000 });

    const groupA = await page
      .locator('.pin-list__row[data-pin-id="sel-a"] .pin-list__group-select')
      .inputValue();
    const groupC = await page
      .locator('.pin-list__row[data-pin-id="sel-c"] .pin-list__group-select')
      .inputValue();
    if (!groupC || groupC !== groupA) {
      throw new Error(
        `expected sel-c to join the existing group sel-a is in: sel-a=${groupA} sel-c=${groupC}`
      );
    }
  });

  // ── 4. Escape cancels the popover (and clears the highlight cue) without
  //     assigning anything. ────────────────────────────────────────────
  await step("Escape cancels the popover and clears the highlight cue", async () => {
    const boxC = await paddedPinBox(page, "sel-c");
    await shiftDrag(page, boxC);
    await page.waitForSelector(".map-select-panel", { timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".map-select-panel", { state: "detached", timeout: 5000 });
    const highlighted = await page
      .locator(".map-pin-labels__label.map-select-highlighted")
      .count();
    if (highlighted !== 0) {
      throw new Error(`Escape left ${highlighted} label(s) highlighted`);
    }
  });

  // ── 5. Inset-filter regression check (js/map-inset.js's pinsForInset()):
  //     enable the inset on the seeded group (containing ONLY
  //     "inset-grouped") and confirm the geographically-adjacent but
  //     UNGROUPED "inset-neighbor" pin never renders inside it. ──────────
  await step("enable the inset on the seeded group", async () => {
    await page.click("#side-tab-design");
    await page.waitForSelector("#side-panel-design:not([hidden])", { timeout: 5000 });
    await page.check("#inset-enabled");
    await page.selectOption("#inset-group", INSET_GROUP_ID);
    await page.waitForSelector(
      '.map-inset-overlay .map-pin-labels__label[data-pin-id="inset-grouped"]',
      { timeout: 10000 }
    );
  });

  await step("the inset does not render the ungrouped neighbor pin", async () => {
    const neighborCount = await page
      .locator('.map-inset-overlay .map-pin-labels__label[data-pin-id="inset-neighbor"]')
      .count();
    if (neighborCount !== 0) {
      throw new Error(
        "inset rendered an ungrouped neighbor pin inside its fitted viewport — pinsForInset() regression"
      );
    }
  });

  await step("disable the inset for a clean handoff", async () => {
    await page.uncheck("#inset-enabled");
    await page.waitForTimeout(100);
  });
}
