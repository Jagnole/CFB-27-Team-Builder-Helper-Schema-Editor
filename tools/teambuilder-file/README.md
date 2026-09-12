# Team Builder save file tools

Read and edit an EA CFB 27 Team Builder save file (`TEAMBUILDER-00n`), and
import a uniform exported from [cfbuniformcreator.com](https://cfbuniformcreator.com)
into one as an **extra uniform** — the uniforms already in the file are left
alone.

The save file format is documented in [`FORMAT.md`](./FORMAT.md). It is a
fixed-size `FBCHUNKS` container holding one zlib stream, and inside that a
tagged tree. The codec round-trips a real save byte for byte, which is the
check everything else rests on.

```
uniform-import-standalone.html   the importer as ONE file — use this one
tbfile.js      container + tree codec (browser and Node, no dependencies)
uniform.js     find, list, clone and edit uniforms; apply a creator kit
kitzip.js      reader for the creator's .zip export
textures.js    fits an export's images into the space there is; finds
               images in a save that nothing points at
png.js         pure-JS PNG decode/encode/downscale (used by the CLI)
imaging-web.js the same job via canvas (used by the page)
cli.js         Node command line
selftest.js    checks the codec and importer against your own files
uniform-import.html/.js   the same page, split up, for loading in the extension
build-standalone.js       regenerates the single-file build
```

## The page

**Download `uniform-import-standalone.html` and open it.** Pick a save file,
pick the export zip, press **Build uniform**, download the result. Nothing
leaves the page.

`uniform-import.html` is the same page with its scripts kept separate,
because extension pages block inline scripts. It only works with
`tbfile.js`, `uniform.js`, `kitzip.js` and `uniform-import.js` sitting in the
same folder — on its own, every control stays inert and the page says so.
After editing any of those, run `node build-standalone.js` to refresh the
single-file build.

Because a save file has a fixed size, the page offers to shrink the export's
baked images until they fit, and shows how much space is left.

## The command line

```sh
node cli.js info      TEAMBUILDER-003        # header, space budget, uniforms
node cli.js roundtrip TEAMBUILDER-003        # prove the codec on your own file
node cli.js uniforms  TEAMBUILDER-003        # per-uniform layer counts
node cli.js clone     TEAMBUILDER-003 --from HOME --name Alt1 --display "Alt 1"
node cli.js prune     TEAMBUILDER-003 [--apply]   # list/remove unused images
node cli.js import    TEAMBUILDER-003 kit.zip [--name Alt1] [--from HOME]
                      [--display "Jordan Alt"] [--prune] [--max-dim 2048]
                      [--keep-flat] [--skip-baked] [--grow] [-o OUT]
```

`import` clones an existing uniform (`--from`, default `HOME`), then writes
the kit over the copy, and prints exactly what it wrote, skipped and could
not map. Without `-o` it writes `<input>-<VariantName>` next to the input.

## What the import writes

The uniform is registered the way the game expects: four designs, four asset
entries, and an entry in the team's uniform list marked as an alternate, with
the in-game name taken from the export (`--display` to override). `uniforms`
prints whether each uniform is listed, so a missing one is visible without
loading the game.

Then, straight from `kit.json`:

- **texture links** — every layer's colour / normal / rsm / layout slot that
  the kit gives as an in-game asset path
- **uploaded images** — each PNG in the export is stored in the save file's
  custom-image table and referenced by the layer that uses it
- **tint colours** — `colors[]` per layer and channel, hex → the file's
  0…1 floats
- **transforms** — scale, offset, rotation (degrees), clamp
- **blend weights** and layer **rsm** values
- **number and nameplate fonts** — matched by asset path, so this does not
  depend on knowing the print block's layout

Not written yet, and listed as such in the report rather than guessed:
number colours, number spacing and width adjustments, number positions,
facemask colour, under-sock colour, the accessory palette, and CID masks.

## Space

A save file is a fixed **7.5 MiB** — `18 + 17,932 + 7,846,388` bytes, with
both region sizes written in the header and nothing recording how much is
actually used. Your sample had about 2.2 MB spare while the sample export
carried 11.9 MB of baked PNGs, so something has to give. In order of how
much they buy you:

- **`--prune` / "Reclaim unused images"** — uploaded images that no layer
  points at any more. The sample save had 1.27 MB of them, one image 1.23 MB
  on its own. Team art (the logo sheet, the end zone) is never touched.
- **Flat images** — an export's maps are often perfectly uniform. A flat
  normal map is the neutral one the shader already assumes; a flat colour map
  is just a colour. Either way it says the same thing at 4×4, so it is stored
  that way: three of the sample export's nine images, 143 KB → 250 bytes.
- **Biggest-first shrinking** — the largest image is shrunk one step at a
  time until the set fits, instead of halving everything together. The sample
  export lands at about 3.2 MB with the jersey and helmet colour maps still
  at 2048px.
- **`--grow` / "Write a bigger file"** — raises the region sizes in the
  header and writes a larger file (16.5 MB with every image untouched). It
  round-trips and re-reads correctly, but **7.5 MiB exactly is almost
  certainly a deliberate limit**, so expect this one to be rejected. It is
  the only way to find out for sure.

With prune plus fitting, the whole sample export goes in at near-full
resolution and the file stays exactly its original size.

## Two things to know before using it in game

1. **Partly tested in game.** A written file loads and the stock uniforms
   render, which proves the container and the tree. An early version wrote
   the uniform's designs but not the team's uniform list, so the extra
   uniform never appeared; the list is written now (see `FORMAT.md` §3).
   An imported uniform then rendered, but wrong: decals had been placed by
   number into stripe slots and tiled across the whole jersey. Placement is
   by layer purpose now. What is still unconfirmed is whether the export's
   flattened base maps belong on the base layer — they carry the design's
   colours, stripes and wordmarks, which nothing else in the export does, so
   the importer writes them by default. Keep a copy of the original save.
2. **Mind the 7.5 MiB budget** — see *Space* above. `--grow` is there to
   test the limit, not to rely on.
