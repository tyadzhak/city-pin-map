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
