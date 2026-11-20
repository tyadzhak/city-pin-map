// Single-level undo for destructive actions (UXR-004). Each offer replaces
// the previous one, so a stale Undo can never apply on top of a newer
// destructive action: the older toast is dismissed and its restore is
// dropped. Rendering goes through showToast, so tests use its sink.

import { showToast } from "./toast.js";

const UNDO_DURATION_MS = 9000;

let pending = null; // { token, handle }

function clearPending() {
  if (!pending) return;
  const { handle } = pending;
  pending = null;
  try {
    handle?.dismiss();
  } catch (err) {
    console.error("undo toast dismiss threw:", err);
  }
}

/**
 * Offer an Undo for the action that just happened.
 * @param {string} message toast text, e.g. "Deleted “Rome”"
 * @param {() => void} restoreFn re-applies the previous state
 */
export function offerUndo(message, restoreFn) {
  clearPending();
  const token = {};
  pending = { token, handle: null };
  pending.handle = showToast(message, {
    type: "info",
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick() {
        // Only the current offer may restore.
        if (!pending || pending.token !== token) return;
        pending = null;
        restoreFn();
      },
    },
  });
}

/** Drop any pending undo. */
export function cancelUndo() {
  clearPending();
}
