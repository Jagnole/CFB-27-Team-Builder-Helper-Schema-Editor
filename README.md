# CFB 27 Team Builder Helper + Schema Editor

A Chrome extension that captures and edits EA Sports College Football 27 Team
Builder data — fonts, helmet materials, and more — without hand-navigating raw
JSON. Includes a built-in schema-aware editor with a searchable, human-readable
picker instead of memorizing cryptic asset codes.

**Not affiliated with or endorsed by EA. Use at your own risk — this edits
locally captured data in your own browser and does not touch EA's servers.**

## Why this exists

Team Builder's JSON payload is the only place that actually controls a team's
number fonts, name fonts, and helmet materials — but there's no in-game UI for
most of it, and the raw structure is a maze of nested, inconsistently-named
fields. Browsers also isolate `ea.com` network traffic from any other site, so
a plain website can't intercept and edit that data on its own. This extension
runs at the browser layer, where it can.

## Features

- **Jersey number font picker** — searchable by school name and year
  ("Boston College (2021)") instead of raw codes (`BC_Jersey_2021_NUM_Array`).
  Confirmed working: writes both fields the game actually reads.
- **Helmet materials** — pick a shell finish by school/year/color and the
  matching accessory material gets set automatically.
- **Vendor Decal picker + gallery** — swap jersey/pants/socks decal brand and
  material (Nike, Adidas, Jumpman, Under Armour, New Balance) in one click.
  Gallery view shows a live color preview of each decal, not just a name.
- **Decal Tint** — apply this team's real colors, or a custom palette you set
  yourself, into the vendor decal's tint fields across jersey, pants, and
  socks at once. One shared palette, not per-piece — Apply All always writes
  the same colors everywhere.
- **Team Colors reference** — a static, always-accurate readout of this
  payload's real school colors, for reference while working anywhere else in
  the tool.
- **Number Color** — tint jersey numbers per channel. Channel counts for 193
  fonts are grounded in real data (a batch analysis of 257 teams' actual
  exports), not guessed per font.
- **Number Spacing** — adjust horizontal kerning between digits, with a
  Reset back to whatever value the font started at.
- **Mask & Stripe Studio** — a separate tab for compositing an uploaded
  texture onto collar/chest decal masks or helmet stripe patterns, with
  per-region color/texture assignment. Exports a PNG for manual upload
  through Team Builder's own custom texture tool — doesn't touch the JSON
  payload at all.
- **Reset to loaded** — revert every edit back to exactly what was fetched,
  with one click.
- Runs entirely locally. Nothing is sent anywhere except EA's own servers
  (to fetch the team you already have open) and back to your own browser.

## Screenshots

*(Add a screenshot of the editor panel here — Connection / Payload / Structured
fields / Push back.)*

## Installation

1. Download this repository as a ZIP (**Code → Download ZIP**) and unzip it
   somewhere permanent — not your Downloads folder, since Chrome needs to keep
   reading from that location.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**, then select the unzipped folder.
5. Click the puzzle-piece icon in Chrome's toolbar and pin this extension so
   its icon stays visible.

That's it — no build step, no dependencies to install.

## Usage

1. Open your team in **EA Sports College Football 27 Team Builder** in the
   browser (any page under `team-builder/...`), so the page's data request
   actually fires.
2. Click the extension's pinned toolbar icon. This opens the schema editor in
   a new tab automatically.
3. In the editor tab, click **Refresh status** — it should find your team's
   data URL.
4. Click **Fetch live JSON** to load your team.
5. Pick a **uniform variant** (Home, Away, etc.) from the dropdown.
6. Use the **Jersey Number Font** and **Helmet Materials** pickers — start
   typing a school name and select from the list.
7. Click **Push edited JSON to Team Builder**.
8. **Reload the Team Builder tab** to see the change take effect.

If something looks wrong, click **Reset to loaded** to discard all edits and
start over from what was originally fetched — no need to re-fetch.

## What's confirmed vs. experimental

This project is built around testing things in-game before trusting them, not
guessing. Everything currently in the editor UI has been confirmed working by
hand-editing and checking the result. Fields that were tried and found
unreliable, or that were never confirmed, were deliberately left out rather
than shipped half-working — see `CHANGELOG.md` for the specifics of what
changed and why.

A couple of features have been built, tested, found not to work as intended,
and deliberately pulled back out rather than left half-broken in the UI —
the code is intact and documented for when they're picked back up:

- **Number Size** — a slider for jersey number scale existed briefly but was
  found to move numbers in the wrong direction on a real in-game check.
  Removed from the UI; see the comment above `renderSizeSection` in
  `editor.js` for exactly what's known and what's still unresolved.
- **Conference Logo Tint** — built and structurally identical to the
  confirmed-working Vendor Decal Tint, but every available way to test it
  against a real conference-assigned team hit a dead end. Parked rather than
  shipped as if proven.

## Project structure

```
manifest.json     Extension configuration (Manifest V3)
background.js     Service worker — captures Team Builder's data requests
                  and serves edited versions back on reload
bridge.js         Runs on ea.com pages, relays request info to background.js
capture.js        Injected into the page to patch fetch/XHR for URL capture
editor.html       The bundled schema editor page (opened from the toolbar)
editor.js         Editor logic, including the built-in font/material/decal
                  catalog and Decal Tint / Number Color logic
mask-studio.js    Mask & Stripe Studio tab — texture compositing, no
                  connection to the JSON payload editor above it
toptabs.js        Switches between the JSON Editor and Mask & Stripe Studio
                  tabs (kept as an external file — extension pages block
                  inline <script> tags by default)
masks/            Bundled mask images used by Mask & Stripe Studio
CHANGELOG.md      Version history for the editor
```

## Troubleshooting

- **Toolbar icon does nothing** — make sure you reloaded the extension
  (`chrome://extensions` → reload icon) after any update, and reloaded the
  Team Builder tab too. A tab open before a reload keeps a stale connection.
- **"No URL entered" / nothing found** — open the actual team page in Team
  Builder first, then click Refresh status again.
- **Errors after updating** — check `chrome://extensions`, click the red
  **Errors** button on this extension's card, and read the top line of red
  text (that's the actual error — everything below it is just code context).

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for version-by-version details of what
changed in the editor.

## Credits

Built by Tyler ([Jagnole](https://github.com/Jagnole)) with development
assistance from Claude (Anthropic). Font, material, and decal catalog data
compiled by hand from in-game asset references and real exported XML/DDS
data — not guessed from averages.

## License

*(Choose one — MIT is a common default for small tools like this if you want
others to be able to freely use and modify it.)*
