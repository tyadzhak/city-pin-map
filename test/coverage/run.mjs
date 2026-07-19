#!/usr/bin/env node
// test/coverage/run.mjs — combined whole-repo coverage orchestrator.
//
// Merges TWO V8 coverage sources into one report:
//   1. Node-side coverage of the logic-layer modules, captured while the
//      existing `node --test` suite runs (NODE_V8_COVERAGE env var).
//   2. Browser-side coverage of the DOM-heavy modules (map.js, app.js,
//      icon-picker.js, ...), captured by driving the real app in headless
//      Playwright chromium and running every scenario under
//      test/coverage/scenarios/*.mjs against it.
//
// Both feed into one monocart-coverage-reports (MCR) instance so the
// aggregate line % reflects the WHOLE repo, not just the logic layer that
// `npm run coverage` already gates. Exits non-zero if the combined line
// coverage is below COVERAGE_THRESHOLD.
//
// Scenario contract (test/coverage/scenarios/*.mjs):
//   export async function run(page) { ... }
// `page` is a live Playwright Page already navigated to the booted app
// (index.html loaded, MapLibre initialized, the Design tab visible) with
// `page.coverage.startJSCoverage({ resetOnNavigation: false })` already
// running — a scenario does not start/stop coverage itself, just drives
// UI. Scenarios run in alphabetical file-name order (hence the `00-` prefix
// convention for the broad boot driver) and are independent: each should
// leave the app in a reasonable state for the next one, but must not
// assume anything about what ran before it beyond "the app is booted".
// Wrap risky interactions in try/catch internally if a failure there
// shouldn't abort the rest of your own scenario — the runner already
// isolates FILE-level failures (one scenario throwing doesn't stop the
// next scenario or the coverage merge), but an uncaught throw still cuts
// that scenario's own remaining steps short.
//
// Usage: node test/coverage/run.mjs   (wired as `npm run coverage:all`)

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { CoverageReport } from "monocart-coverage-reports";
import { startServer, PROJECT_ROOT } from "./serve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(__dirname, "scenarios");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "coverage-all");
const COVERAGE_THRESHOLD = 80;
const BOOT_SELECTOR = "#side-tab-design";
const BOOT_TIMEOUT_MS = 20000;

function log(...args) {
  console.log("[coverage:all]", ...args);
}

// ── Step 1: node-side coverage ──────────────────────────────────────────
//
// Runs the existing `node --test` suite (same discovery `npm test` uses)
// with NODE_V8_COVERAGE pointed at a scratch dir. Node's test runner
// process-isolates each test FILE into its own subprocess by default, so
// this can produce multiple coverage-*.json dumps — all inherit the env
// var and get picked up below. A non-zero exit here means the test suite
// itself is broken; that's a harder failure than "coverage too low", so we
// abort immediately rather than trying to report a coverage number from a
// red suite.
async function runNodeTestsWithCoverage() {
  const nodeCovDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-pin-map-node-v8-"));
  log("running `node --test` with NODE_V8_COVERAGE=" + nodeCovDir);

  const exitCode = await new Promise((resolve) => {
    const child = spawn("node", ["--test"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, NODE_V8_COVERAGE: nodeCovDir },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(
      `node --test exited ${exitCode} — fix the failing test(s) before running the coverage gate.`
    );
  }

  return loadNodeV8CoverageEntries(nodeCovDir);
}

// Reads every coverage-*.json dump NODE_V8_COVERAGE wrote, flattens their
// `.result` arrays, and — critically — attaches `.source` for any `file://`
// entry. Node's raw V8 coverage JSON never includes source text (unlike
// Playwright's page.coverage, which does), and MCR silently drops any V8
// entry lacking a `.source` string, so without this every node-covered
// module would vanish from the report instead of contributing lines.
// `node:`-scheme internals (no file:// url) are left alone; they get
// filtered out downstream by entryFilter anyway.
function loadNodeV8CoverageEntries(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  log(`found ${files.length} node coverage dump(s) in ${dir}`);

  const byFile = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      log(`skipping unparsable coverage dump ${file}: ${err.message}`);
      continue;
    }
    const entries = Array.isArray(parsed.result) ? parsed.result : [];
    for (const entry of entries) {
      if (typeof entry.url === "string" && entry.url.startsWith("file://")) {
        try {
          entry.source = fs.readFileSync(fileURLToPath(entry.url), "utf8");
        } catch {
          // File vanished/unreadable between coverage capture and now, or
          // it's some node-internal file:// url we don't care about —
          // leave source unset, MCR will drop this entry harmlessly.
        }
      }
    }
    byFile.push(entries);
  }

  // Cleanup: this is a scratch dir under os.tmpdir(), not part of the repo,
  // but there's no reason to leave it behind.
  fs.rmSync(dir, { recursive: true, force: true });

  return byFile;
}

// ── Step 2: browser-side coverage ───────────────────────────────────────

async function runBrowserScenarios() {
  const { url, close } = await startServer();
  log(`serving project root at ${url}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("pageerror", (err) => log("[pageerror]", err.message));
  page.on("requestfailed", (req) => {
    // Expected/benign in a sandboxed run: map tiles and some CDN font/
    // sprite assets may not resolve. We don't fail on this — the point of
    // this harness is JS coverage, not a fully-tiled map.
    log("[requestfailed]", req.url(), req.failure()?.errorText);
  });

  let browserEntries = [];
  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });

    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector(BOOT_SELECTOR, { timeout: BOOT_TIMEOUT_MS });
    log("app booted (Design tab present)");

    await runScenarios(page);

    browserEntries = await page.coverage.stopJSCoverage();
    log(`collected browser coverage for ${browserEntries.length} script entries`);
  } finally {
    await browser.close();
    await close();
  }

  return browserEntries;
}

// Discovers test/coverage/scenarios/*.mjs in alphabetical order, imports
// each, and calls its `run(page)` export inside a try/catch so one
// scenario's failure can't take down the rest of the run (and can't take
// down the coverage merge that follows) — only its own coverage
// contribution is smaller than if it had fully succeeded. Failures are
// logged loudly rather than swallowed, per CLAUDE.md's "never silently
// swallow" rule, even though this is dev-only tooling.
async function runScenarios(page) {
  if (!fs.existsSync(SCENARIOS_DIR)) {
    log("no scenarios dir found, skipping");
    return;
  }
  const files = fs
    .readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();

  if (files.length === 0) {
    log("no scenario files found under test/coverage/scenarios/");
    return;
  }

  for (const file of files) {
    const fullPath = path.join(SCENARIOS_DIR, file);
    log(`--- scenario: ${file} ---`);
    let mod;
    try {
      mod = await import(pathToFileURL(fullPath).href);
    } catch (err) {
      log(`✘ scenario ${file} failed to import:`, err?.stack || err);
      continue;
    }
    if (typeof mod.run !== "function") {
      log(`✘ scenario ${file} does not export an async function run(page) — skipping`);
      continue;
    }
    try {
      await mod.run(page);
      log(`✔ scenario ${file} completed`);
    } catch (err) {
      log(`✘ scenario ${file} threw:`, err?.stack || err);
    }
  }
}

// ── Step 3: merge + report + gate ───────────────────────────────────────
//
// entryFilter runs on the RAW script url (file:///…/js/storage.js from
// node, http://127.0.0.1:PORT/js/storage.js from the browser) — this is
// the primary gate deciding which V8 entries are processed at all. Order
// matters: first matching pattern wins.
const entryFilter = {
  "**/node_modules/**": false,
  "**/*.test.mjs": false,
  "**/test-helpers.mjs": false,
  "**/xml-shim.mjs": false,
  "**/maplibre-gl*": false,
  "**/js/*.js": true,
  "**/**": false,
};

// sourceFilter runs on the already-normalized, already-host-stripped
// sourcePath (see the `sourcePath` option below) — it's what gates which
// files the `all` option's untested-file scan is allowed to add as empty
// (0%) coverage placeholders, so a never-imported module still shows up
// as 0% instead of silently vanishing from the aggregate (mirrors c8's
// `--all` in the existing `npm run coverage` script).
const sourceFilter = {
  "js/*.js": true,
  "**/**": false,
};

// Browser script urls resolve to something like
// "127.0.0.1-54321/js/storage.js" (MCR's default host+port-prefixed
// normalization for http(s) urls) while node's file:// urls already
// normalize to the clean repo-relative "js/storage.js". This collapses
// both to the same "js/storage.js" key so coverage of the same file
// captured from both sides merges into one row instead of two.
function sourcePath(filePath) {
  const idx = filePath.indexOf("/js/");
  if (idx !== -1) return filePath.slice(idx + 1);
  return filePath;
}

async function mergeAndReport(nodeEntryBatches, browserEntries) {
  const mcr = new CoverageReport({
    name: "city-pin-map — combined whole-repo coverage",
    outputDir: OUTPUT_DIR,
    logging: "info",
    entryFilter,
    sourceFilter,
    sourcePath,
    // Untested-file placeholders: any js/*.js module neither node nor the
    // browser scenarios ever loaded still shows up at 0% instead of just
    // being absent from the report (honest aggregate, same spirit as c8's
    // --all in npm run coverage).
    all: {
      dir: [path.join(PROJECT_ROOT, "js")],
      filter: {
        "**/*.test.mjs": false,
        "**/test-helpers.mjs": false,
        "**/xml-shim.mjs": false,
        "**/*.js": true,
        "**/*": false,
      },
    },
    reports: ["text", "lcov", "html"],
  });

  for (const batch of nodeEntryBatches) {
    if (batch.length) await mcr.add(batch);
  }
  if (browserEntries.length) await mcr.add(browserEntries);

  const results = await mcr.generate();
  return results;
}

function printPerFileTable(results) {
  const files = (results.files || [])
    .slice()
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  const rows = files.map((f) => ({
    file: f.sourcePath,
    lines: f.summary.lines.pct,
    covered: f.summary.lines.covered,
    total: f.summary.lines.total,
  }));

  log("Per-file line coverage:");
  const widest = Math.max(...rows.map((r) => r.file.length), 4);
  for (const r of rows) {
    const pctStr = (typeof r.lines === "number" ? r.lines.toFixed(2) : "0.00") + "%";
    log(`  ${r.file.padEnd(widest)}  ${pctStr.padStart(7)}  (${r.covered}/${r.total})`);
  }
}

// ── Orchestration ────────────────────────────────────────────────────────

async function main() {
  const nodeEntryBatches = await runNodeTestsWithCoverage();
  const browserEntries = await runBrowserScenarios();

  log("merging node + browser coverage and generating report...");
  const results = await mergeAndReport(nodeEntryBatches, browserEntries);

  if (!results) {
    // MCR returns undefined when there's no coverage data at all to
    // report on — a real failure of this pipeline, not a "below
    // threshold" outcome, so this is a crash, not a gate failure.
    throw new Error(
      "monocart-coverage-reports produced no results — no coverage data was added."
    );
  }

  printPerFileTable(results);

  const linesPct = results.summary.lines.pct;
  const pctDisplay = typeof linesPct === "number" ? linesPct.toFixed(2) : String(linesPct);
  log(`Combined aggregate line coverage: ${pctDisplay}% (threshold: ${COVERAGE_THRESHOLD}%)`);
  log(`Full HTML/lcov/text reports written to: ${OUTPUT_DIR}`);

  if (typeof linesPct !== "number" || linesPct < COVERAGE_THRESHOLD) {
    console.error(
      `\n[coverage:all] FAIL — combined line coverage ${pctDisplay}% is below the ${COVERAGE_THRESHOLD}% gate.`
    );
    process.exitCode = 1;
    return;
  }

  log("PASS — combined line coverage meets the threshold.");
}

// Guard against node's OWN test runner discovering and re-executing this
// file. `node --test` (with no explicit path args — exactly how the
// existing `npm test` / `npm run coverage` scripts invoke it, per
// CLAUDE.md's "keep them unchanged" rule) auto-discovers every .js/.mjs
// file that lives anywhere under a directory literally named `test/`,
// recursively — that's this whole `test/coverage/` tree, by design (the
// harness spec put it there). Without this guard, the very first line of
// `runNodeTestsWithCoverage()` below (spawning ANOTHER `node --test`)
// would import THIS file as a "test", which would call `main()` again,
// which would spawn ANOTHER `node --test`, recursing until node's own
// "run() is being called recursively" safeguard kicks in — silently
// tripling the run time and corrupting both node coverage passes.
//
// The obvious-looking `import.meta.url === pathToFileURL(process.argv[1])`
// "am I the entry point" check does NOT work here and was tried first: node's
// test runner isolates each discovered file into its own child process by
// re-invoking `node <that file>` directly, so inside that child
// `process.argv[1]` genuinely IS this file's own path — indistinguishable
// from a real direct `node test/coverage/run.mjs` invocation by argv alone
// (confirmed empirically). The reliable signal is `NODE_TEST_CONTEXT`, an
// env var node's test runner sets in every child it spawns (e.g.
// `"child-v8"`) and which is absent from a genuine direct invocation —
// including the one THIS file does of `node --test` in
// runNodeTestsWithCoverage() below, so that spawn's own coordinator
// process doesn't see it either, only the per-file children it isolates.
//
// serve.mjs and the scenario files need no equivalent guard: they register
// zero `node:test` test() cases, so node's test runner just reports them
// as trivially-passing empty files when it sweeps them in (confirmed
// empirically before landing this fix).
const isDirectEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const isNodeTestRunnerChild = Boolean(process.env.NODE_TEST_CONTEXT);

if (isDirectEntryPoint && !isNodeTestRunnerChild) {
  main().catch((err) => {
    console.error("[coverage:all] CRASHED:", err?.stack || err);
    process.exitCode = 1;
  });
}
