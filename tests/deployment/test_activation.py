import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('activation', Path(__file__).parents[2] / 'scripts/activate-deployment.py')
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class ActivationTests(unittest.TestCase):
    def test_route_insertion_preserves_existing_site_bytes(self):
        config = 'other.example {\n respond 200\n}\ntool.talium.site {\n\timport /etc/caddy/acg.caddy\n\thandle /MakoLrcStudio/* { file_server }\n\thandle @toolbox { file_server }\n}\n'
        changed = activation.with_route(config)
        self.assertEqual(changed.replace(activation.IMPORT, '', 1), config)
        self.assertEqual(activation.with_route(changed), changed)
        with self.assertRaises(ValueError):
            activation.with_route('unexpected.example {}\n')

    def test_archive_cannot_escape_root_or_create_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE), ('link', tarfile.SYMTYPE)]:
                archive = root / 'bad.tar.gz'
                with tarfile.open(archive, 'w:gz') as bundle:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = '/etc/caddy/Caddyfile'
                    bundle.addfile(member)
                with self.assertRaises(ValueError):
                    activation.extract_release(archive, root / 'out')
            self.assertFalse((root / 'escape').exists())

    def test_regular_bundle_extracts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'good.tar.gz'
            with tarfile.open(archive, 'w:gz') as bundle:
                member = tarfile.TarInfo('./assets/file.js')
                member.size = 3
                bundle.addfile(member, io.BytesIO(b'abc'))
            activation.extract_release(archive, root / 'out')
            self.assertEqual((root / 'out/assets/file.js').read_bytes(), b'abc')


if __name__ == '__main__':
    unittest.main()
