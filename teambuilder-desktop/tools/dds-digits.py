"""Decode a jersey number font texture (.dds, exported from Frosty) into digit images.

    pip install texture2ddecoder
    python tools/dds-digits.py <font.dds> <out dir>

Number fonts are texture arrays: layer N is digit N (0-9). Some fonts carry a
second set in layers 10-19, shaped for the left (tens) digit of a two-digit
number, e.g. Oregon 2026 "Origin of Speed", whose digits taper inward like a
shield. All 10 or 20 layers are written as <out dir>/<layer>.rgba (raw 8-bit
RGBA, top mip) plus meta.json with the size, ready for tools/add-number-preview.js.
"""
import json
import os
import struct
import sys

import texture2ddecoder

# DXGI format -> (decoder, bytes per 4x4 block)
FORMATS = {
    71: (texture2ddecoder.decode_bc1, 8), 72: (texture2ddecoder.decode_bc1, 8),
    77: (texture2ddecoder.decode_bc3, 16), 78: (texture2ddecoder.decode_bc3, 16),
    98: (texture2ddecoder.decode_bc7, 16), 99: (texture2ddecoder.decode_bc7, 16),
}


def main(path, out):
    data = open(path, 'rb').read()
    if data[:4] != b'DDS ' or data[84:88] != b'DX10':
        sys.exit('Expected a DX10 .dds texture array (export the NUM_Array texture from Frosty as .dds).')
    height, width = struct.unpack_from('<II', data, 12)
    mips = max(1, struct.unpack_from('<I', data, 28)[0])
    dxgi, _dim, _misc, layers = struct.unpack_from('<IIII', data, 128)
    if dxgi not in FORMATS:
        sys.exit(f'Unsupported texture format (DXGI {dxgi}). Supported: BC1, BC3, BC7.')
    decode, block = FORMATS[dxgi]

    def level_bytes(w, h):
        return max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * block

    chain = sum(level_bytes(max(1, width >> m), max(1, height >> m)) for m in range(mips))
    body = data[148:]
    if layers < 10 or len(body) < chain * 10:
        sys.exit(f'Expected at least 10 layers (digits 0-9); found {layers}.')

    os.makedirs(out, exist_ok=True)
    count = 20 if layers >= 20 and len(body) >= chain * 20 else 10
    for digit in range(count):
        start = digit * chain
        bgra = decode(body[start:start + level_bytes(width, height)], width, height)
        rgba = bytearray(bgra)
        rgba[0::4], rgba[2::4] = bgra[2::4], bgra[0::4]
        with open(os.path.join(out, f'{digit}.rgba'), 'wb') as f:
            f.write(rgba)
    with open(os.path.join(out, 'meta.json'), 'w') as f:
        json.dump({'width': width, 'height': height, 'layers': layers, 'dxgi': dxgi,
                   'source': os.path.basename(path)}, f)
    print(f'{width}x{height}, {layers} layers -> {count} digit images in {out}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
