// js/settings-panel.js — Renders the settings modal.
//
// Wires:
//   - #open-settings click → open modal
//   - .modal__close + .modal__backdrop + Escape → close
//   - input blur per [data-key-input] → settings.setKey(...) + status pill flip
//   - .settings-section__reveal click → toggle input type between password/text
//
// The modal stays in the DOM at all times; we toggle the [hidden] attribute.
// Status pills hydrate from settings.getAllKeys() on open and on every store
// notify (via subscribe).

import * as settings from "./settings.js";

const PROVIDERS = ["stadia", "maptiler", "thunderforest"];

let modalEl = null;
let triggerEl = null;
let pendingFocusProvider = null;

export function initSettingsPanel() {
  modalEl = document.getElementById("settings-modal");
  triggerEl = document.getElementById("open-settings");
  if (!modalEl || !triggerEl) return;

  triggerEl.addEventListener("click", () => openModal());

  // Close affordances: any element marked data-settings-close, plus Escape.
  modalEl.querySelectorAll("[data-settings-close]").forEach((el) => {
    el.addEventListener("click", () => closeModal());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalEl.hidden) closeModal();
  });

  // Per-provider input wiring.
  for (const provider of PROVIDERS) {
    const input = modalEl.querySelector(`[data-key-input="${provider}"]`);
    const reveal = modalEl.querySelector(`[data-reveal-for="${provider}"]`);
    if (!input) continue;

    // Persist on blur. Trim whitespace — pasted keys often have a trailing
    // newline. Empty after trim is treated as "clear" by the store.
    input.addEventListener("blur", () => {
      const value = input.value.trim();
      if (value !== input.value) input.value = value;
      settings.setKey(provider, value);
    });

    // Reveal toggle. We swap input type between password and text rather
    // than reading-and-replacing so the cursor and selection survive.
    if (reveal) {
      reveal.addEventListener("click", () => {
        input.type = input.type === "password" ? "text" : "password";
      });
    }
  }

  // Reflect store state in the UI on every change (and once initially via
  // notify() inside hydrate(), which app.js calls before this init).
  settings.subscribe(renderFromStore);
  renderFromStore(settings.getAllKeys());
}

function renderFromStore(keys) {
  if (!modalEl) return;
  for (const provider of PROVIDERS) {
    const input = modalEl.querySelector(`[data-key-input="${provider}"]`);
    const pill = modalEl.querySelector(`[data-status-for="${provider}"]`);
    const value = keys[provider] ?? "";
    if (input && document.activeElement !== input) {
      // Only sync the input value if the user isn't actively editing it,
      // to avoid clobbering a half-typed key on a notify storm.
      input.value = value;
    }
    if (pill) {
      const isSet = Boolean(value);
      pill.textContent = isSet ? "Set" : "Not set";
      pill.classList.toggle("is-set", isSet);
    }
  }
}

// Open the modal, optionally scrolling to a specific provider's section
// and focusing its input. Used by the picker's locked-row click.
export function openSettingsScrolledTo(provider) {
  pendingFocusProvider = provider;
  openModal();
}

function openModal() {
  if (!modalEl) return;
  modalEl.hidden = false;
  // Scroll to a section if requested + focus its input.
  if (pendingFocusProvider) {
    const section = modalEl.querySelector(
      `[data-provider="${pendingFocusProvider}"]`
    );
    if (section) {
      section.scrollIntoView({ block: "start", behavior: "instant" });
      const input = section.querySelector("[data-key-input]");
      if (input) input.focus();
    }
    pendingFocusProvider = null;
  } else {
    // Default focus: first input.
    const firstInput = modalEl.querySelector("[data-key-input]");
    if (firstInput) firstInput.focus();
  }
}

function closeModal() {
  if (!modalEl) return;
  modalEl.hidden = true;
  pendingFocusProvider = null;
  // Force-flush any pending blur save by blurring the active element. The
  // input's blur handler runs synchronously and persists.
  if (
    document.activeElement &&
    typeof document.activeElement.blur === "function"
  ) {
    document.activeElement.blur();
  }
}
