import struct
import tempfile
import unittest
import zlib
import json
from pathlib import Path
from verify_installer import verify


def fixture():
    prefix = b'MZ' + bytes(1022)
    payload = b'installer-payload' * 30
    header = struct.pack('<7I', 0, 0xDEADBEEF, 0x6C6C754E, 0x74666F73, 0x74736E49, 512, 28 + len(payload) + 4)
    data = prefix + header + payload
    return data + struct.pack('<I', zlib.crc32(data[512:]))


class ReleaseValidation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'setup.exe'
    def tearDown(self):
        self.temp.cleanup()
    def test_valid_crc(self):
        self.path.write_bytes(fixture())
        self.assertEqual(verify(self.path)['bytes'], len(fixture()))
    def test_truncated_copy(self):
        self.path.write_bytes(fixture()[:-20])
        with self.assertRaisesRegex(ValueError, 'length mismatch'):
            verify(self.path)
    def test_unfinished_header(self):
        data = bytearray(fixture())
        struct.pack_into('<I', data, 1024 + 24, 0)
        self.path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'not finalized'):
            verify(self.path)
    def test_changed_payload(self):
        data = bytearray(fixture()); data[-10] ^= 1
        self.path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'CRC mismatch'):
            verify(self.path)

    def test_tauri_installer_reuses_legacy_install_location(self):
        root = Path(__file__).resolve().parent.parent
        config = json.loads((root / 'src-tauri' / 'tauri.conf.json').read_text(encoding='utf-8'))
        self.assertEqual(
            config['bundle']['windows']['nsis']['template'],
            '../installer/tauri-installer-template.nsi',
        )
        template = (root / 'installer' / 'tauri-installer-template.nsi').read_text(encoding='utf-8')
        restore = template.split('Function RestorePreviousInstallLocation', 1)[1].split('FunctionEnd', 1)[0]
        self.assertIn(r'Software\Microsoft\Windows\CurrentVersion\Uninstall\KXL', restore)
        self.assertIn('SetRegView 32', restore)
        self.assertIn('SetRegView 64', restore)
        self.assertIn(r'${FileExists} "$4\${MAINBINARYNAME}.exe"', restore)
        self.assertIn('StrCpy $INSTDIR $4', restore)


if __name__ == '__main__':
    unittest.main()
