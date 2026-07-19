// Shared, dependency-free test shim for running city-pin-map's browser-
// targeted ES modules under `node --test` (no jsdom/linkedom — see
// CLAUDE.md's "no build step" spirit extended to test tooling: keep the
// dev-only test harness as small and hand-rolled as the existing
// js/svg-ingest.test.mjs convention).
//
// USAGE: every *.test.mjs file MUST import this module (or a named export
// from it) as its FIRST import, before importing the module under test:
//
//   import "./test-helpers.mjs";
//   import { loadPins } from "./storage.js";
//
// ESM evaluates imports in source order, so this guarantees the globals
// below exist before any logic module evaluates its own top-level code.
//
// WHY these globals and no others (investigated by importing every logic
// module in a bare `node` process — see tmp/probe.mjs during harness setup):
//   - None of storage.js / svg-ingest.js / import-foreign.js / pins.js /
//     groups.js / settings.js / user-icons.js / icons.js / geocode.js /
//     backup.js / search.js touch `localStorage`, `document`, `window`, or
//     `navigator` at MODULE-EVAL time — every reference is inside a
//     function body. So nothing throws on a bare `import()` with zero
//     shimming.
//   - But calling those functions during a test does touch globals:
//       * storage.js: every load*/save* function calls `localStorage.*`;
//         showError() calls `document.getElementById("error-banner")`.
//       * import-foreign.js: setImportStatus() calls
//         `document.getElementById("import-file-status")`.
//       * backup.js: triggerDownload() calls `document.createElement("a")`
//         and `document.body.appendChild(a)`.
//       * search.js: initSearch()/handleInput()/renderResults()/etc. do
//         real DOM-tree work — querySelector, createElement, dataset,
//         classList, addEventListener/dispatchEvent, closest().
//   - Nothing in the logic layer reads `window.*` or `navigator.*`, so no
//     window/navigator shim is installed (kept out on purpose — don't add
//     one speculatively; extend this file if a future module needs it).
//
// So this shim installs: (1) a Map-backed localStorage, (2) a small but
// real fake DOM (element tree, id registry, classList, dataset, events)
// sufficient to drive the actual code paths above rather than stubbing
// them out. c8/test authors should prefer exercising real behavior (e.g.
// actually dispatching a "click" event) over mocking the module's own
// functions.

// ── localStorage ────────────────────────────────────────────────────────

class MemoryStorage {
  #map = new Map();

  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }

  setItem(key, value) {
    this.#map.set(String(key), String(value));
  }

  removeItem(key) {
    this.#map.delete(String(key));
  }

  clear() {
    this.#map.clear();
  }

  key(index) {
    return Array.from(this.#map.keys())[index] ?? null;
  }

  get length() {
    return this.#map.size;
  }
}

// Node 22+ ships its own experimental, file-backed `globalThis.localStorage`
// (flagged by a `--localstorage-file` warning at startup) — so a
// feature-detection guard like `if (!globalThis.localStorage)` never fires
// and tests would hit Node's half-configured built-in instead of this
// shim (its `.clear()` throws without an explicit backing file). Always
// replace it with our own Map-backed instance via defineProperty, since
// Node's version is a configurable accessor property that a plain `=`
// assignment can also satisfy, but defineProperty makes the override
// unambiguous and immune to that accessor's own setter validation.
Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
  enumerable: true,
});

/**
 * Clear all localStorage keys. Call in `beforeEach` (or at the top of each
 * test) so tests are order-independent — storage.js's load-and-save
 * functions share the one globalThis.localStorage instance across every
 * test in a file.
 */
export function resetStorage() {
  globalThis.localStorage.clear();
}

// ── Minimal fake DOM ────────────────────────────────────────────────────
//
// Real enough to let storage.js/import-foreign.js/backup.js/search.js run
// their actual DOM-touching branches (not jsdom — hand-rolled, ~100 lines,
// covers exactly: element creation, an id registry backing
// getElementById/querySelector("#id"), classList, dataset, attributes,
// a parent/child tree, and a tiny addEventListener/dispatchEvent/closest
// trio for search.js's delegated-click pattern).

function createFakeDocument() {
  const byId = new Map();

  class FakeElement {
    constructor(tagName) {
      this.tagName = String(tagName || "").toUpperCase();
      this._id = "";
      this.className = "";
      this.textContent = "";
      this.hidden = false;
      this.value = "";
      this.href = "";
      this.download = "";
      this.dataset = {};
      this.children = [];
      this.parentNode = null;
      this._attrs = new Map();
      this._listeners = new Map();

      const self = this;
      this.classList = {
        add(...names) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          for (const n of names) set.add(n);
          self.className = Array.from(set).join(" ");
        },
        remove(...names) {
          self.className = self.className
            .split(/\s+/)
            .filter((c) => c && !names.includes(c))
            .join(" ");
        },
        contains(n) {
          return self.className.split(/\s+/).includes(n);
        },
        toggle(n) {
          if (this.contains(n)) this.remove(n);
          else this.add(n);
        },
      };
    }

    get id() {
      return this._id;
    }

    set id(value) {
      if (this._id) byId.delete(this._id);
      this._id = value;
      if (value) byId.set(value, this);
    }

    setAttribute(name, value) {
      this._attrs.set(name, String(value));
      if (name === "id") this.id = String(value);
    }

    getAttribute(name) {
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }

    removeAttribute(name) {
      this._attrs.delete(name);
    }

    appendChild(node) {
      this.children.push(node);
      node.parentNode = this;
      return node;
    }

    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    }

    removeChild(node) {
      this.children = this.children.filter((c) => c !== node);
      node.parentNode = null;
      return node;
    }

    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }

    replaceChildren(...nodes) {
      for (const c of this.children) c.parentNode = null;
      this.children = [];
      this.append(...nodes);
    }

    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    }

    dispatchEvent(event) {
      if (!event.target) event.target = this;
      if (typeof event.preventDefault !== "function") event.preventDefault = () => {};
      for (const fn of this._listeners.get(event.type) ?? []) fn(event);
      return true;
    }

    click() {
      this.dispatchEvent({ type: "click", target: this });
    }

    matches(selector) {
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
      return this.tagName === selector.toUpperCase();
    }

    closest(selector) {
      let node = this;
      while (node) {
        if (typeof node.matches === "function" && node.matches(selector)) return node;
        node = node.parentNode;
      }
      return null;
    }
  }

  const body = new FakeElement("body");

  return {
    body,
    activeElement: null,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => byId.get(id) ?? null,
    querySelector: (selector) => {
      if (typeof selector === "string" && selector.startsWith("#")) {
        return byId.get(selector.slice(1)) ?? null;
      }
      return null;
    },
  };
}

if (!globalThis.document) {
  globalThis.document = createFakeDocument();
}

// ── fetch stub ──────────────────────────────────────────────────────────

/**
 * Replace globalThis.fetch with `handler(url, init)`, which must return
 * (or resolve to) a Response-like object: `{ ok, status, json: async () =>
 * ... }`. Returns a restore() function — call it (or just let the next
 * mockFetch() call overwrite it) to avoid leaking a stub across test files.
 * Network is never touched: CI has no route to nominatim.openstreetmap.org.
 *
 * Example:
 *   const restore = mockFetch((url) => jsonResponse([{ display_name: "Kyiv, Ukraine", lat: "50.45", lon: "30.52" }]));
 *   const results = await searchCities("kyiv");
 *   restore();
 */
export function mockFetch(handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(String(input), init);
  return () => {
    globalThis.fetch = previous;
  };
}

/** Convenience Response-like builder for use with mockFetch's handler. */
export function jsonResponse(body, { status = 200, ok = status >= 200 && status < 300 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

// ── Fake timers note ────────────────────────────────────────────────────
//
// search.js debounces via setTimeout (DEBOUNCE_MS). Do NOT use real sleeps
// to wait it out. Instead, inside a test:
//
//   test("debounces search input", (t) => {
//     t.mock.timers.enable({ apis: ["setTimeout"] });
//     ...trigger the debounced call...
//     t.mock.timers.tick(350); // >= search.js's DEBOUNCE_MS
//     ...assert...
//   });
//
// node:test's per-test `t.mock.timers` is automatically restored after
// each test — no manual teardown needed here.
