// Pins-tab "File" menu (UXR-006): one disclosure button that hosts the data
// actions (backup, import, checkpoint, new map). Content-agnostic — the items
// keep their own ids and click handlers in app.js; this module only owns the
// open/close state, focus movement and keyboard behaviour of the menu.

export function initFileMenu() {
  const btn = document.getElementById("file-menu-btn");
  const list = document.getElementById("file-menu-list");
  if (!btn || !list) return;

  const items = () => Array.from(list.querySelectorAll('[role="menuitem"]'));

  function open(focusIndex) {
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const all = items();
    if (focusIndex != null && all.length > 0) {
      all[(focusIndex + all.length) % all.length].focus();
    }
  }

  function close({ returnFocus = false } = {}) {
    if (list.hidden) return;
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (returnFocus) btn.focus();
  }

  btn.addEventListener("click", () => {
    if (list.hidden) open();
    else close();
  });

  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      open(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      open(-1);
    }
  });

  list.addEventListener("keydown", (e) => {
    const all = items();
    const idx = all.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      all[(idx + 1) % all.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      all[(idx - 1 + all.length) % all.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      all[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      all[all.length - 1].focus();
    } else if (e.key === "Tab") {
      close();
    }
  });

  // Escape works from the button too, hence document-level.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !list.hidden) {
      e.stopPropagation();
      close({ returnFocus: true });
    }
  });

  // Choosing any item closes the menu; the item's own handler (registered in
  // app.js) still runs because this listener never stops propagation.
  list.addEventListener("click", (e) => {
    if (e.target.closest('[role="menuitem"]')) close();
  });

  document.addEventListener("pointerdown", (e) => {
    if (list.hidden) return;
    if (btn.contains(e.target) || list.contains(e.target)) return;
    close();
  });
}
