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
node cli.js clone     TEAMBUILDER-003 --from HOME --name Alt1
node cli.js import    TEAMBUILDER-003 kit.zip [--name Alt1] [--from HOME]
                      [--skip-baked] [--max-texture-bytes 500000] [-o OUT]
```

`import` clones an existing uniform (`--from`, default `HOME`), then writes
the kit over the copy, and prints exactly what it wrote, skipped and could
not map. Without `-o` it writes `<input>-<VariantName>` next to the input.

## What the import writes

Straight from `kit.json`:

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

## Two things to know before using it in game

1. **Nothing here has been tested in game.** The output is structurally
   valid and re-reads correctly — that is what is proven. Keep a copy of the
   original save file.
2. **A save file cannot grow.** The container size is fixed; the sample had
   about 2.2 MB spare while the sample export carried 11.9 MB of baked
   PNGs. Either let the page shrink them, cap them with
   `--max-texture-bytes`, or use `--skip-baked` to import the recipe only.
