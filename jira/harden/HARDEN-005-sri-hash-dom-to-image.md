# HARDEN-005: SRI hash for the dom-to-image-more CDN tag

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-005`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S`                                         |
| **Depends on**  | `None`                                      |

## Summary

Add a `integrity` (Subresource Integrity) hash and `crossorigin` attribute to the `dom-to-image-more@3.5.0` `<script>` tag in `index.html`, matching the defensive style of the Leaflet tag immediately above it. If unpkg ever serves an unexpected payload at that exact version, the browser will refuse to execute it instead of silently running tampered code.

## Context

Today `index.html` has:

```html
<!-- Leaflet 1.9.4 — has integrity + crossorigin -->
<script defer src=".../leaflet.js" integrity="sha256-..." crossorigin=""></script>

<!-- dom-to-image-more 3.5.0 — no SRI -->
<script defer src=".../dom-to-image-more.min.js"></script>
```

The threat model for a personal-use app is low — there is no auth, no PII server-side, the page never runs unattended on someone else's machine. But the cost of adding SRI is one line, and the inconsistency between the two tags is the kind of small thing future-me looks at and wonders whether it was intentional.

`CLAUDE.md` → "Libraries (load via CDN)" already pins exact versions. SRI is the matching commitment: not just "this version" but "this exact bytes."

## Acceptance criteria

- [x] The `dom-to-image-more@3.5.0` script tag in `index.html` has `integrity="sha384-..."` and `crossorigin="anonymous"` attributes.
- [x] The hash is computed against the actual file served at `https://unpkg.com/dom-to-image-more@3.5.0/dist/dom-to-image-more.min.js` and is recorded in the implementation prompt's verification step.
- [x] The app loads cleanly with the new attributes — PNG export still works.
- [x] If the integrity attribute is deliberately corrupted (test by changing one character), the browser refuses to execute the script and the export-button click surfaces the existing "dom-to-image-more not loaded" error via the banner.
- [x] No regressions in any other previously completed task.
- [x] No errors in the browser console under normal load.

## Files affected

```
~ index.html
```

## Out of scope

- Vendoring the libraries locally. That's a different (larger) decision about supply-chain trust; this task is the ten-second version of the same idea.
- Adding SRI to the Leaflet stylesheet (it already has one).
- Switching CDNs (jsDelivr, cdnjs). unpkg has been fine.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read this task file in full.

Task: Add SRI integrity + crossorigin attributes to the dom-to-image-more <script> tag.

Requirements:
- Compute the SHA-384 hash of the exact file served by:
    https://unpkg.com/dom-to-image-more@3.5.0/dist/dom-to-image-more.min.js
  Use either the `srihash.org` web tool or:
    curl -sL https://unpkg.com/dom-to-image-more@3.5.0/dist/dom-to-image-more.min.js \
      | openssl dgst -sha384 -binary | openssl base64 -A
- Add integrity="sha384-{hash}" and crossorigin="anonymous" to the existing
  <script> tag for dom-to-image-more in index.html. Keep the defer attribute.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Do not change the version. Do not switch CDNs.

Deliverables:
- index.html with the updated script tag.

Verification:
- Open the app. Open browser DevTools → Network tab. Reload. Confirm the
  dom-to-image-more.min.js request shows status 200 and no SRI errors in the
  Console tab.
- Pin a city and click Export PNG. Confirm an image downloads.
- Temporarily change one character of the integrity hash, reload, click
  Export PNG. Confirm the export fails and the existing error banner shows
  "Could not export the map. Try again." Restore the correct hash before
  finishing.
- All acceptance criteria in this task file are satisfied.

When finished:
- Update this task file's Status field to `Done` and tick every acceptance
  criteria checkbox.
- Record the actual SHA-384 hash you computed in the Notes section of this
  file.
- Create a feature branch `harden-005-sri-hash-dom-to-image`.
- Commit with message
  `HARDEN-005: pin dom-to-image-more@3.5.0 with SRI integrity hash` and the
  Co-Authored-By footer matching this repo's commit style.
- Push the branch and open a pull request titled
  `HARDEN-005: pin dom-to-image-more@3.5.0 with SRI integrity hash`
  against `main`.
```

## Notes

- The hash is committed alongside the version pin in `index.html`. Bumping the version in the future will require recomputing the hash; that's by design — the hash is the version's fingerprint.
- Computed SHA-384 for `dom-to-image-more@3.5.0/dist/dom-to-image-more.min.js`:
  `sha384-0PEs9VXKn6x/atQ5H1woMo0cQQnIz11UdqMzjvkDj+U+vxY4xwwj9J+gsbvLNcL9`
  (via `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`)

---

## Superseded by HARDEN-010 / HARDEN-012 (2026-05-08)

`dom-to-image-more` was retired during the MapLibre cutover. The SRI hash this task pinned no longer applies to any loaded asset — the entire `<script>` tag was removed from `index.html` in HARDEN-010, and HARDEN-012's cleanup pass confirmed no remaining references. This task remains in the historical record for the SRI-hardening pattern it established; the same pattern should be reapplied to the new `maplibre-gl@4.7.1` tag in a follow-up task once the dependency is treated as production-stable.
