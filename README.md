# City Pin Map

A small web app for pinning cities on a world map and exporting the result as a PNG — for printing, framing, gifting, or scrapbooking travel memories.

All three milestones are shipped: search and pin cities, drag pins, recolor, group them, draw a route through them, switch basemap styles, back the whole set up to a JSON file, and export to PNG (current view, square, 16:9, A4 portrait/landscape, A3 portrait/landscape) with an optional title and subtitle.

## How to run it (non-technical version)

The app is just a folder of HTML, CSS, and JavaScript — there is nothing to install or build. But browsers refuse to load JavaScript modules from a `file://` path, so you need a tiny local web server. macOS already has one built in.

### macOS

1. Double-click **`start.command`** in the project folder. A Terminal window opens, then your default browser opens at the app.
2. **First time only:** macOS may pop up *"start.command can't be opened because it is from an unidentified developer."* Click **OK**, then right-click `start.command` → **Open** → **Open** in the confirmation dialog. macOS remembers the choice; future double-clicks just work.
3. To stop the app, close the Terminal window. The server shuts down with it.

If port 8000 is already in use, the launcher tries 8001, 8002, … up to 8010 and opens the browser at whichever it picks.

### Windows

1. Install [Python](https://www.python.org/downloads/) once. During install, tick **"Add Python to PATH"**.
2. Open the **Command Prompt** (Start → type "cmd").
3. Navigate to the project folder. Easiest: open the folder in File Explorer, click the address bar, type `cmd`, press Enter — a Command Prompt opens already inside the folder.
4. Type:
   ```
   python -m http.server 8000
   ```
   and press **Enter**.
5. Open your browser and visit **http://localhost:8000**.
6. To stop the app, switch back to Command Prompt and press **Ctrl + C**.

### What you can do in the app

- **Search a city** — type into the search box, click a result. A pin appears.
- **Move a pin** — drag it on the map.
- **Rename a pin** — click the pencil icon in the side panel.
- **Recolor a pin** — click its color swatch in the side panel.
- **Delete a pin** — click the **✕** in the side panel.
- **Group pins** — open the Groups panel (top of the side panel), click "Add group", give it a name and color, then assign pins to the group via the dropdown next to each pin row.
- **Show a route line** — tick **Show route** in the header. Pins are connected in the order they were added.
- **Change map style** — header dropdown. Try Light or Dark for cleaner posters.
- **Export to PNG** — fill in Title/Subtitle if you want them, pick a Format preset, click **Export PNG**. The image downloads to your usual Downloads folder.

Everything you do is saved in the browser automatically. Closing the tab and reopening the app brings everything back. Clearing your browser data still wipes pins, so use **Export JSON** in the side panel (next to the Pins heading) to download a backup file you can keep alongside your other documents — and **Import JSON** to restore it on another machine or after a wipe.

## How to run it (developer version)

Any static server is fine:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`. No build step. Edits to `index.html` / `css/` / `js/` show up on reload.

## Where the source lives

```
city-pin-map/
├── index.html          # Single entry point
├── css/styles.css
├── js/                 # 11 ES modules — see CLAUDE.md for the layout
└── jira/               # Per-task design docs (Core + Nice-to-have + Hardening)
    ├── core/           # CORE-001 → CORE-012, all Done
    ├── nice-to-have/   # NICE-001 → NICE-007, all Done
    └── harden/         # HARDEN-001 → HARDEN-006, all Done
```

`PROJECT.md` is the original scope and tech-stack rationale. `CLAUDE.md` is the operating manual for AI coding agents working on the next milestone — read that before adding any feature.

## How tasks are added (future milestones)

The repo uses a two-pass workflow: a `GENERATE_TASKS.md` prompt produces individual `TASK-NNN.md` files, each with its own implementation prompt, acceptance criteria, and `Status` field. To extend the project, add a new milestone folder under `jira/`, drop in a `GENERATE_TASKS.md`, and run it through a coding agent. See `jira/TASK_TEMPLATE.md` for the format.
