// User-uploaded custom icons (PIL-001). Mirrors the pub/sub shape of
// pins.js and groups.js so the registry merge in icons.js can subscribe
// uniformly.
//
// Shape of a user icon (see spec § Data model):
// {
//   id: string,                  // crypto.randomUUID()
//   name: string,                // user-supplied
//   tintable: boolean,           // SDF when true; raster RGBA when false
//   fillSvg: string,             // sanitized SVG markup (monochrome if tintable)
//   attribution: { artistName: string|null, sourceUrl: string|null } | null,
//   createdAt: number,
// }

const userIcons = [];
const listeners = [];

function notify() {
  const snapshot = list();
  for (const fn of listeners.slice()) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error("user-icon store listener threw:", err);
    }
  }
}

export function add(icon) {
  userIcons.push({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...icon,
  });
  notify();
}

export function remove(id) {
  const idx = userIcons.findIndex((i) => i.id === id);
  if (idx === -1) return;
  userIcons.splice(idx, 1);
  notify();
}

export function list() {
  return userIcons.slice();
}

export function replaceAll(next) {
  userIcons.length = 0;
  userIcons.push(...next);
  notify();
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
