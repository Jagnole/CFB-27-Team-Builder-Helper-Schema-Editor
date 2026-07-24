CFB 27 Team Builder Helper + Schema Editor

A Chrome extension that captures and edits EA Sports College Football 27 Team Builder data — fonts, helmet materials, and more — without hand-navigating raw JSON. Includes a built-in schema-aware editor with a searchable, human-readable picker instead of memorizing cryptic asset codes.

Not affiliated with or endorsed by EA. Use at your own risk — this edits locally captured data in your own browser and does not touch EA's servers.

Why this exists

Team Builder's JSON payload is the only place that actually controls a team's number fonts, name fonts, and helmet materials — but there's no in-game UI for most of it, and the raw structure is a maze of nested, inconsistently-named fields. Browsers also isolate ea.com network traffic from any other site, so a plain website can't intercept and edit that data on its own. This extension runs at the browser layer, where it can.

Features
Jersey number font picker — searchable by school name and year ("Boston College (2021)") instead of raw codes (BC_Jersey_2021_NUM_Array). Confirmed working: writes both fields the game actually reads.
Helmet materials — pick a shell finish by school/year/color and the matching accessory material gets set automatically.
Reset to loaded — revert every edit back to exactly what was fetched, with one click.
Runs entirely locally. Nothing is sent anywhere except EA's own servers (to fetch the team you already have open) and back to your own browser.

Installation
Download this repository as a ZIP (Code → Download ZIP) and unzip it somewhere permanent — not your Downloads folder, since Chrome needs to keep reading from that location.
Open Chrome and go to chrome://extensions.
Turn on Developer mode (top-right toggle).
Click Load unpacked, then select the unzipped folder.
Click the puzzle-piece icon in Chrome's toolbar and pin this extension so its icon stays visible.

That's it — no build step, no dependencies to install.

Usage
Open your team in EA Sports College Football 27 Team Builder in the browser (any page under team-builder/...), so the page's data request actually fires.
Click the extension's pinned toolbar icon. This opens the schema editor in a new tab automatically.
In the editor tab, click Refresh status — it should find your team's data URL.
Click Fetch live JSON to load your team.
Pick a uniform variant (Home, Away, etc.) from the dropdown.
Use the Jersey Number Font and Helmet Materials pickers — start typing a school name and select from the list.
Click Push edited JSON to Team Builder.
Reload the Team Builder tab to see the change take effect.

If something looks wrong, click Reset to loaded to discard all edits and start over from what was originally fetched — no need to re-fetch.

What's confirmed vs. experimental

This project is built around testing things in-game before trusting them, not guessing. Everything currently in the editor UI has been confirmed working by hand-editing and checking the result. Fields that were tried and found unreliable, or that were never confirmed, were deliberately left out rather than shipped half-working — see CHANGELOG.md for the specifics of what changed and why.
