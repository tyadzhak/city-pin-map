// Transient, non-blocking notifications. Replaces the old full-width error
// banner (which covered the header controls) and blocking alert() dialogs.
//
// Toasts are plain DOM stacked at the bottom-center of the map area, so they
// never overlap the header/search and are never part of an export (export
// reads canvas pixels, not the DOM).

const DEFAULT_DURATION_MS = 5000;
// Errors and toasts carrying an action (e.g. Undo) need more reading/reaction
// time than a passive info message.
const LONG_DURATION_MS = 10000;
const VALID_TYPES = new Set(["info", "success", "error"]);

let regionEl = null;
// Test seam: node tests run without a real layout and assert on messages, not
// on DOM. When set, showToast hands the call to the sink instead of rendering.
let sink = null;

export function setToastSink(fn) {
  sink = typeof fn === "function" ? fn : null;
}

function noopHandle() {
  return { dismiss() {} };
}

function ensureRegion() {
  if (typeof document === "undefined" || !document.body) return null;
  if (regionEl && regionEl.parentNode) return regionEl;
  const host =
    (document.querySelector && document.querySelector(".app-map")) ||
    document.body;
  regionEl = document.createElement("div");
  regionEl.id = "toast-region";
  regionEl.className = "toast-region";
  host.appendChild(regionEl);
  return regionEl;
}

/**
 * Show a toast.
 * @param {string} message
 * @param {{ type?: "info"|"success"|"error",
 *           action?: { label: string, onClick: () => void },
 *           duration?: number }} [options] duration in ms; 0 = sticky.
 * @returns {{ dismiss: () => void }}
 */
export function showToast(message, options = {}) {
  const { action } = options;
  const type = VALID_TYPES.has(options.type) ? options.type : "info";
  if (sink) {
    sink(message, { ...options, type });
    return noopHandle();
  }
  const region = ensureRegion();
  if (!region) {
    console.warn("toast region unavailable; message:", message);
    return noopHandle();
  }

  const duration =
    typeof options.duration === "number" && options.duration >= 0
      ? options.duration
      : type === "error" || action
        ? LONG_DURATION_MS
        : DEFAULT_DURATION_MS;

  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");

  const text = document.createElement("span");
  text.className = "toast__message";
  text.textContent = message;
  el.appendChild(text);

  let timer = null;
  let remaining = duration;
  let startedAt = 0;
  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (timer !== null) clearTimeout(timer);
    el.remove();
  }

  function arm() {
    if (duration === 0) return;
    startedAt = Date.now();
    timer = setTimeout(dismiss, remaining);
  }
  function pause() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(1000, remaining - (Date.now() - startedAt));
  }

  if (action && typeof action.onClick === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast__action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      dismiss();
      action.onClick();
    });
    el.appendChild(btn);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast__close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "✕";
  close.addEventListener("click", dismiss);
  el.appendChild(close);

  el.addEventListener("mouseenter", pause);
  el.addEventListener("mouseleave", () => {
    if (!dismissed && timer === null) arm();
  });

  region.appendChild(el);
  arm();
  return { dismiss };
}
