# Schema editor changelog

Version number shown in the editor's header and in the activity log on load.
Bump `EDITOR_VERSION` in `editor.js` with each round of changes, and log what
changed here.

## v0.04
- Added three new jersey number font catalog entries, sourced from real
  `JerseyPartItem` ebx XML dumps: **Notre Dame Shamrock 2026**, **Wisconsin
  Shamrock 2026**, and **Northwestern Purple Gothic**. Each also carries a
  `spacing` value read from the XML's `numberspacing.x` — captured for now,
  not yet wired to anything the picker writes (see note in the PR/commit).

## v0.03
- Added a **live preview** above the field pickers: a simple 2D stand-in figure
  (helmet + jersey outline) that updates as you pick a helmet shell material or
  jersey number font, plus the currently-selected label for each. Not a real
  render of the in-game look — the helmet color is guessed from the material's
  label text (most already name their color), and the jersey shape/number font
  are placeholders, since this tool has no access to the actual game textures
  or fonts. It's meant as a quick sanity check while picking, not a preview of
  the final result.

## v0.02
- Fixed the picker input resetting to its placeholder text ("Pick from
  catalog...") right after a selection was applied, even though the
  underlying field was set correctly. The box now shows what was actually
  picked. Clears automatically when a new payload loads or the variant
  changes, so it can't show a stale pick for the wrong context.

## v0.01
- Removed the standalone Accessory picker — Shell already sets the matching
  accessory automatically, so the separate tab was redundant.
- Removed Facemask entirely (not needed).
- Removed the "Set this field only" override inputs/buttons added for testing;
  reverted to plain read-only "what's already there" display under each field.
- Added a **Reset to loaded** button — snapshots the payload the moment it's
  fetched, and reverts to exactly that snapshot, discarding session edits.
- Fixed **Clear mock** giving no visible feedback — it now refreshes the
  Connection panel right after, so "Mocks stored" / "Network mocking" visibly
  update instead of appearing to do nothing.
