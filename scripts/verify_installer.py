"""Validate an unsigned NSIS installer before distributing it. Never bypass CRC."""
from pathlib import Path
import hashlib
import struct
import sys
import zlib


def verify(path: Path) -> dict:
    data = path.read_bytes()
    signature = b'\xef\xbe\xad\xdeNullsoftInst'
    marker = data.find(signature)
    if marker < 4:
        raise ValueError('NSIS header not found')
    start = marker - 4
    if start % 512:
        raise ValueError('NSIS header is misaligned')
    if len(data) < start + 28:
        raise ValueError('NSIS header is incomplete')
    flags, magic, s1, s2, s3, header_size, following_size = struct.unpack_from('<7I', data, start)
    if not header_size or following_size < 32:
        raise ValueError('NSIS output is incomplete: header was not finalized')
    expected_size = start + following_size
    if len(data) != expected_size:
        raise ValueError(f'NSIS output length mismatch: {len(data)} != {expected_size}')
    stored = struct.unpack_from('<I', data, len(data) - 4)[0]
    actual = zlib.crc32(data[512:-4])
    if stored != actual:
        raise ValueError(f'NSIS CRC mismatch: {stored:08x} != {actual:08x}')
    return {'bytes': len(data), 'crc32': f'{actual:08x}', 'sha256': hashlib.sha256(data).hexdigest()}


if __name__ == '__main__':
    import json
    print(json.dumps(verify(Path(sys.argv[1]))))
