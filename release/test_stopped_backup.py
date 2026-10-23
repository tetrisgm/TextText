import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('stopped-backup.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupTests(unittest.TestCase):
    def test_exact_content_and_links(self):
        root = Path(tempfile.mkdtemp(prefix='texttext-backup-test-'))
        source = root / 'source'
        source.mkdir()
        (source / 'note').write_bytes(b'exact document\x00')
        (source / 'link').symlink_to('note')
        module.backup({'vault': source}, root / 'copy', lambda: None)
        self.assertEqual(module.inventory(source), module.inventory(root / 'copy/vault'))
        self.assertTrue((root / 'copy/manifest.json').exists())

    def test_interleaved_edit_refuses_receipt(self):
        root = Path(tempfile.mkdtemp(prefix='texttext-backup-test-'))
        source = root / 'source'
        source.write_bytes(b'before')
        calls = []
        def check():
            if calls:
                source.write_bytes(b'new edit')
            calls.append(True)
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            module.backup({'vault': source}, root / 'copy', check)
        self.assertFalse((root / 'copy/manifest.json').exists())
        self.assertEqual(source.read_bytes(), b'new edit')


if __name__ == '__main__':
    unittest.main()
