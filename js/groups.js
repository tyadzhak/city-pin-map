// Group store. Mirrors js/pins.js (CORE-003) intentionally so future tasks
// (NICE-005 pin-to-group assignment) can reach for the same shape on either
// side without surprises. Groups are independent entities — pins reference a
// group by id, but the group's lifecycle is owned here.

const groups = [];
const listeners = [];

function notify() {
  const snapshot = listGroups();
  for (const fn of listeners.slice()) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error("group store listener threw:", err);
    }
  }
}

export function addGroup({ name, color }) {
  const group = {
    id: crypto.randomUUID(),
    name,
    color,
    createdAt: Date.now(),
  };
  groups.push(group);
  notify();
  return group;
}

export function removeGroup(id) {
  const idx = groups.findIndex((g) => g.id === id);
  if (idx === -1) return;
  groups.splice(idx, 1);
  notify();
}

// Undo support (UXR-004): re-insert a deleted group verbatim at its old
// index. No-op if the id already exists.
export function restoreGroup(group, index) {
  if (groups.some((g) => g.id === group.id)) return;
  const i = Number.isInteger(index) ? Math.max(0, Math.min(index, groups.length)) : groups.length;
  groups.splice(i, 0, { ...group });
  notify();
}

export function updateGroup(id, patch) {
  const idx = groups.findIndex((g) => g.id === id);
  if (idx === -1) return;
  groups[idx] = { ...groups[idx], ...patch, id: groups[idx].id };
  notify();
}

export function listGroups() {
  return groups.slice();
}

export function replaceAll(newGroups) {
  groups.length = 0;
  groups.push(...newGroups);
  notify();
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

// Palette for new-group defaults. The first entry deliberately is NOT the
// default pin red: a group whose color equals the default pin color makes
// assigning inherited pins look like a no-op.
export const GROUP_PALETTE = [
  "#1d3557",
  "#2a9d8f",
  "#f4a261",
  "#9d4edd",
  "#e63946",
  "#264653",
];

// First palette color that is neither the default pin color nor already used
// by a group; if every candidate is taken, rotate by group count but still
// skip the default pin color.
export function pickGroupColor(existingGroups, defaultPinColor) {
  const norm = (c) => String(c || "").toLowerCase();
  const def = norm(defaultPinColor);
  const used = new Set((existingGroups || []).map((g) => norm(g.color)));
  const usable = GROUP_PALETTE.filter((c) => norm(c) !== def);
  const free = usable.find((c) => !used.has(norm(c)));
  if (free) return free;
  const n = (existingGroups || []).length;
  return usable[n % usable.length];
}

// Pin-count wording shared by the group rows and the delete tooltip.
export function formatPinCount(n) {
  if (!n) return "No pins";
  return n === 1 ? "1 pin" : `${n} pins`;
}
