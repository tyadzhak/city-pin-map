const pins = [];
const listeners = [];

function notify() {
  const snapshot = listPins();
  for (const fn of listeners.slice()) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error("pin store listener threw:", err);
    }
  }
}

export function addPin({ name, lat, lon, color, group = null }) {
  const pin = {
    id: crypto.randomUUID(),
    name,
    lat,
    lon,
    color,
    group,
    createdAt: Date.now(),
  };
  pins.push(pin);
  notify();
  return pin;
}

export function removePin(id) {
  const idx = pins.findIndex((p) => p.id === id);
  if (idx === -1) return;
  pins.splice(idx, 1);
  notify();
}

export function updatePin(id, patch) {
  const idx = pins.findIndex((p) => p.id === id);
  if (idx === -1) return;
  pins[idx] = { ...pins[idx], ...patch, id: pins[idx].id };
  notify();
}

export function listPins() {
  return pins.slice();
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
