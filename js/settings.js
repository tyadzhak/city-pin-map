// js/settings.js — In-memory store for per-provider API keys.
//
// Mirrors the pub/sub shape of pins.js and groups.js. Three providers
// (stadia, maptiler, thunderforest); each key is a string. Empty string
// = "not set". The store does NOT validate keys — invalid keys surface
// when the user picks a token-required style and the style JSON fetch
// fails, routed through map.js setStyleSafely → storage.js showError.
//
// Single source of truth during a session is the in-memory `state`
// object. localStorage round-trips happen at hydrate() and on every
// setKey() call, via the storage.js loadApiKey/saveApiKey wrappers.

import { loadAllApiKeys, saveApiKey } from "./storage.js";

const VALID_PROVIDERS = ["stadia", "maptiler", "thunderforest"];

const state = {
  stadia: "",
  maptiler: "",
  thunderforest: "",
};

const listeners = [];

function notify() {
  // Snapshot copy so listeners can't mutate the live state.
  const snapshot = { ...state };
  for (const fn of listeners.slice()) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error("settings store listener threw:", err);
    }
  }
}

// Load all three keys from localStorage into the in-memory state. Call
// once at boot, before any consumer (style picker, settings panel, map
// resolver) reads the store. Idempotent — safe to call again, but the
// usual call site is app.js init().
export function hydrate() {
  const loaded = loadAllApiKeys();
  for (const provider of VALID_PROVIDERS) {
    state[provider] = loaded[provider] ?? "";
  }
  notify();
}

export function getKey(provider) {
  if (!VALID_PROVIDERS.includes(provider)) return "";
  return state[provider];
}

export function setKey(provider, value) {
  if (!VALID_PROVIDERS.includes(provider)) return;
  const next = value ?? "";
  if (state[provider] === next) return; // no-op on identical value
  state[provider] = next;
  saveApiKey(provider, next);
  notify();
}

export function getAllKeys() {
  return { ...state };
}

// True when either (a) the provider is keyless (not in VALID_PROVIDERS —
// e.g. openfreemap, wikimedia) or (b) a non-empty key is set. The picker
// uses this to decide whether to show a row as locked.
export function isProviderUnlocked(provider) {
  if (!VALID_PROVIDERS.includes(provider)) return true;
  return Boolean(state[provider]);
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
