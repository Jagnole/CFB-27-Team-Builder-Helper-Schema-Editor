# The Team Builder save file format (`TEAMBUILDER-00n`)

Everything here was recovered by reading one real save file
(`TEAMBUILDER-003`, a 7,864,338-byte file written 2026-08-17) and is
verified by round-tripping it: the file parses to a tree, the tree
re-serializes to a **byte-for-byte identical** payload, and the rebuilt
container re-reads to the same payload. Run `node cli.js roundtrip <file>`
to check that on your own save.

Where something is a reasonable reading rather than a proven one, it says
so. Nothing below has been confirmed *in game* — see "Untested" at the end.

## 1. Container

```
offset 0          "FBCHUNKS"
offset 12         uint32 LE  size of the data region that follows the header
...               fixed-size header block: team name, nickname, abbreviation,
                  team code, an ISO timestamp, and small JSON blobs
                  (pipelineInfluences, teamBuilderRecords, topPlayerInfos,
                  rivalries) in fixed-width fields
headerSize        one zlib stream (0x78 0xDA) holding the whole team
                  headerSize = fileSize - uint32@12   (17,950 in the sample)
end of stream     0x00 padding to the end of the file
```

The total file size is fixed, so **a save file has a hard space budget**: in
the sample, 7,846,388 bytes for the compressed payload, of which 5,556,899
were used — about 2.2 MB spare. Writing more than that cannot be done
without changing the file size, which the tool refuses to do.

The zero padding matters when reading: `DecompressionStream` in the browser
rejects trailing bytes, so the stream has to be cut at its true end (the
last non-zero byte, plus up to four bytes in case the stream's own Adler-32
checksum ends in zeros).

## 2. Payload: a tagged tree

The inflated payload is a flat sequence of top-level records:

```
record  := hash24 type value
```

`hash24` is a little-endian 24-bit field id. The sample has three records:
`#70d892` (the field schema tables), `#7448d2` (the team: players, uniforms,
stadium, custom images) and `#21d9d2` (a string map of file metadata:
author, fileVersion, teamDisplayName …).

### Value types

| type   | name   | encoding |
|--------|--------|----------|
| `0x00` | int    | varint (below) |
| `0x01` | string | varint byte length *including* the NUL, then UTF-8 bytes ending in `0x00` |
| `0x02` | blob   | varint byte length, then raw bytes (this is where uploaded PNGs live) |
| `0x03` | object | `(hash24, type, value)*` then a `0x00` byte |
| `0x04` | array  | elementType, varint count, then that many values |
| `0x05` | map    | keyType (always `0x01`), valueType, varint count, then `(string, value)*` |
| `0x0a` | float  | 4 bytes, **big-endian** IEEE-754 |

An object ends at a `0x00` byte where a field id would start, so field ids
are never zero. Fields are stored in ascending hash order.

### The varint

Not LEB128. The **first** byte carries six value bits, a sign bit and a
continue bit; every following byte carries seven more bits, low group first:

```
byte 0:  c s v v v v v v      c = more bytes follow, s = negative
byte n:  c v v v v v v v
value = v0 + v1<<6 + v2<<13 + v3<<20 ...
```

So 21 is `15`, 85 is `95 01`, 158 is `9e 02`. Getting this wrong is the
single easiest way to mis-parse the file: the first group is six bits wide,
not seven.

## 3. Uniforms

Four sibling maps hold the designs, one per piece, keyed by a design slug,
plus one map of uniform asset entries:

```
#7448d2 / #74489a
  #a95b8f  map  uniform assets   "U_<teamCode>_<PIECE>_<VARIANT>"
  #2d5ba2  map  helmet designs   "<teamCode>-<variant>-helmet"
  #f92cab  map  jersey designs
  #b41bc2  map  pants designs
  #ebf8ce  map  socks designs
  #345ed2  map  custom images    "<teamCode>_<10 random letters>"
```

The stock uniforms are `HOME`/`AWAY` in asset names but `home`/`away` in
design slugs, so **read the slug out of the asset entry** rather than
rebuilding it (`#6de8c2` below). Custom variants use the same spelling in
both.

Uniform asset entry (`#a95b8f` values):

| field | meaning |
|-------|---------|
| `#ee3c87` | asset name, e.g. `U_RCVVFYeAOa_JERSEY_HOME` |
| `#6de8c2` | design slug, e.g. `RCVVFYeAOa-home-jersey` |
| `#2f3bc3` | int, same per piece across variants (93 helmet, 162 jersey, 161 pants, 158 socks) — purpose unknown |
| `#2f3bcf` | int, 446 for HOME/AWAY and the piece value for the others — purpose unknown (INFERRED: a "based on" or slot id) |

Custom image entry (`#345ed2` values):

| field | meaning |
|-------|---------|
| `#74488a` | blob: the PNG bytes as uploaded |
| `#78498f` | string: its `cdn.mcr.ea.com` URL, or empty for an image added locally |

### One design (a helmet, jersey, pants or socks)

| field | meaning |
|-------|---------|
| `#383db2` | layer container |
| &nbsp;&nbsp;`#a5fdb6` | array of 20 **overlays** — `overlay_1 … overlay_20` in the uniform creator's naming |
| &nbsp;&nbsp;`#251db6` | array of 6 **materials** — `material_1 … material_6` |
| &nbsp;&nbsp;`#2d998e` | a third array of 5 layers (purpose unconfirmed) |
| `#321cb6` | preset asset path, e.g. `…/jerseys/presets/OU_JERSEY_2023_WHITE_preset` |
| `#651bba` | design name, e.g. `NIKE_Jersey_2023_VaportUntouchable_02` |
| `#703b9a`, `#72d9ba` | two print blocks (numbers / nameplate), each `{font, flags, 6 print layers, 2 more}` |
| `#f4dc9a`, `#f4dcba` | further piece settings (facemask, sock colours and similar live somewhere in here — not yet pinned down) |

### One layer (overlay or material)

| field | sub-field | meaning |
|-------|-----------|---------|
| `#afe9a6` | `#ac18b2` | layer label shown in the editor (`Seams`, `Custom Layer 2`) |
| `#733bcb` | `#723bcb` | rsm: `#ebdcb6` shininess, `#ac59ca` reflectivity, `#28ddce` metalness (0…1) |
| | `#623bcb`, `#673bcb` | two more colour-shaped structs, `-1` when unused |
| `#b49bd2` | `#32fb8e` / `#27fb8e` / `#22fb8e` | tint **colorR / colorG / colorB**, each an RGB struct using those same three ids for r/g/b, 0…1 in 1/255 steps |
| | `#e4dbd2` | tint mode (0 in almost every layer; 10 seen once) |
| `#ad29d3` | `#6c38ce` | scale `{#f30bd7 U, #f30bdb V}` |
| | `#b369be` | offset `{U, V}` |
| | `#21fdca` | rotation in **degrees** (180 and 5 observed) |
| | `#76cd8e` | clamp `{U, V}` — only ever `1,1` or `0,0`, so a bool (INFERRED: the creator's `clampUv`) |
| | `#ae4ccf` | packed mirror `{#f758da offsetV, #f858da scaleU, #f958da scaleV, #fa58da offsetU}` — kept in step with the fields above |
| `#a4cb8a` | `#22fb8e`, `#a2fcba`, `#e238be`, `#624bca` | four blend weights (INFERRED as colour, normal, rsm, occlusion in that order) plus `#e4db8a` mode |
| `#338dd3` | `#32fb8e` | colour texture |
| | `#adfcba` | normal texture |
| | `#ed2cd3` | rsm texture |
| | `#741eb2` | fourth texture slot (INFERRED: the creator's `Layout` role) |

Each texture slot is `{#648ad3 link, #259cd3 flag}`. The link is either an
in-game asset path (`ContentShared/characters/player/parts/uniforms/…`) or
the key of an entry in the custom image map — that is how an uploaded PNG
is referenced.

## 4. Field ids

The ids behave like a rolling hash of the field name: names that differ
only in their last character give ids that differ only in the low byte by
exactly that character's value. That is how the tint channels were read as
colorB / colorG / colorR (`0x8efb22` / `0x27` / `0x32`, and
`'B' < 'G' < 'R'` by 5 then 11) and the four-float vectors as w/x/y/z. The
hash itself has not been recovered, so ids are used as opaque constants and
the names above are read off structure and values, not computed.

Two ids appear in unrelated structs (`#32fb8e` as both a tint channel and
the colour-texture slot, `#22fb8e` as both a tint channel and a blend
weight). With 24-bit ids that is most likely a collision, which is harmless
as long as ids are only ever resolved inside a known parent.

## 5. Untested

- Nothing written by this tool has been loaded **in game**. The file is
  structurally valid and re-reads correctly; that is all that is proven.
- A locally added image has no CDN URL. Whether Team Builder uploads it on
  the next save, or ignores an image it has no URL for, is unknown.
- `#2f3bc3` / `#2f3bcf` on the asset entry are copied from the source
  variant unchanged.
- The two print blocks, `#f4dc9a`/`#f4dcba`, and the third layer array are
  only partly understood, so the importer leaves them as cloned.
