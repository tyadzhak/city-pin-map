# PROJECT.md — City Pin Map

## Goal

A locally-running web app where the user can:

1. Search for cities from any country and pin them on a world map.
2. Customize how the pins look (label, color).
3. Export the current map view as a PNG image for personal use (printing, framing, gifting, scrapbooking).

The output image is the product. Everything else exists to make a good image.

## Users and use cases

- Someone making a "places I've been" poster for the wall.
- Someone making a personalized gift map for a partner, friend, or family member.
- Someone documenting a multi-city trip.
- Someone planning a future itinerary visually.

## Milestones

### Core (MVP)

The minimum that makes the app useful end-to-end:

- Interactive world map with pan and zoom.
- Add a city by name, with autocomplete-style geocoding (so "Lisbon" resolves to the right coordinates without the user knowing them).
- Display a list of all current pins with edit and delete.
- Rename a pin's label (the geocoder's output isn't always what you want printed).
- Pick a color per pin.
- Export the current map view as a PNG.
- Save and load pin sets via `localStorage` so a session survives a page refresh.

### Nice-to-have (v2)

Quality-of-life and aesthetic upgrades after the MVP is in daily use:

- Connecting lines between pins (great for travel routes).
- Custom title and subtitle text rendered into the exported image.
- Multiple map styles (minimalist light, dark, vintage/sepia, etc.) — major impact on poster look.
- Adjustable export dimensions and aspect ratio (square for social, A4/A3 for print, 16:9 for screensavers).
- Drag pins to fine-tune position.
- Group pins (e.g. by trip or theme), with a different color per group.

### Hardening (v3)

Reliability, polish, and friendly-handoff work after daily use revealed the rough edges:

- JSON backup and restore so a browser-data wipe or machine switch doesn't cost the user their pins.
- A double-clickable macOS launcher so the non-technical user never has to open a terminal.
- Visible export progress feedback during the multi-second framed-PNG path.
- Short, readable default pin names (`"City, Country"`) instead of Nominatim's full address string.
- Subresource Integrity hash on the second CDN library, matching the existing Leaflet tag.
- A3 portrait and A3 landscape export presets alongside A4.

## Out of scope

- User accounts, login, cloud sync.
- Sharing links or collaborative editing.
- Mobile-first design (desktop is the primary target).
- Any service that requires billing setup or a credit card.
- Server-side rendering or generation.

## Tech stack

| Concern              | Choice                                    | Why                                                 |
|----------------------|-------------------------------------------|-----------------------------------------------------|
| Markup / scripting   | Plain HTML + ES modules                   | Zero build step. Open the file and it works.        |
| Map rendering        | MapLibre GL JS 4.7.1                      | Free, mature, no API key, hardware-accelerated.     |
| Map tiles            | OpenFreeMap (vector) + Wikimedia / OpenTopoMap / Esri (raster) | Hybrid: 4 vector + 3 raster, all keyless.           |
| Geocoding            | Nominatim (OpenStreetMap)                 | Free, no key. Rate-limited to 1 req/sec.            |
| PNG export           | Native HTML5 Canvas                       | `getCanvas() → drawImage()` + title strip via `ctx.fillText`. No external library. |
| Persistence          | `localStorage`                            | No backend needed for personal use.                 |
| Styling              | Plain CSS                                 | Project is too small to justify a framework.        |

## Architectural notes

- The app is a single `index.html` plus a few small JS modules. See `CLAUDE.md` for the file layout.
- State is held in memory in a single pin store. `localStorage` is a serializer at save/load points, not the source of truth during a session.
- Geocoding is debounced and rate-limited to respect Nominatim's policy.
- Exporting "the current view" means: capture the map element exactly as it appears on screen, including pan/zoom, pin positions, and labels. Tile attribution must remain visible per OSM's license. Markers and the route line are layers inside the WebGL canvas (GeoJSON source + circle / line layers), so a single `getCanvas().toDataURL()` captures everything in one shot — no DOM walk, no post-compositing.

## Risks and mitigations

| Risk                                                         | Mitigation                                                              |
|--------------------------------------------------------------|-------------------------------------------------------------------------|
| Nominatim rate limits or temporary blocks                    | Debounce input, cache recent queries, show clear errors.                |
| PNG export misses tiles that haven't loaded                  | Wait for tile-load events before triggering capture.                    |
| `localStorage` quota exceeded for huge pin sets              | Unlikely at personal scale, but show a graceful error if it happens.    |
| Tile attribution accidentally cropped from export            | Render attribution into the exported image; verify in acceptance tests. |

## Definition of project success

You can sit down on a Sunday afternoon, pin every city you've visited (or want to visit), and walk away with a PNG you'd be happy to print and put on a wall.
