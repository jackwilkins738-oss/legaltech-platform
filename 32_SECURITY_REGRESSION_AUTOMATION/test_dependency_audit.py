import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from dependency_audit import audit_package

class DependencyAuditTests(unittest.TestCase):
    def fixture(self, root, locked=True, version='8.23.0'):
        manifest = root / 'package.json'
        manifest.write_text(json.dumps({'devDependencies': {'pg': '8.23.0'}}))
        if locked:
            (root / 'package-lock.json').write_text(json.dumps({'lockfileVersion': 3,
                'packages': {'': {'devDependencies': {'pg': version}}}}))
        return manifest

    def test_missing_lock_blocks_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'required'):
                audit_package(self.fixture(Path(directory), locked=False), lambda *a, **k: self.fail('network invoked'))

    def test_stale_lock_blocks_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'does not match'):
                audit_package(self.fixture(Path(directory), version='8.0.0'), lambda *a, **k: self.fail('network invoked'))

    def test_install_failure_blocks_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def runner(args, **kwargs):
                calls.append(args)
                raise subprocess.CalledProcessError(1, args)
            with self.assertRaises(subprocess.CalledProcessError):
                audit_package(self.fixture(Path(directory)), runner)
            self.assertEqual(len(calls), 1)

    def test_vulnerability_or_registry_failure_fails_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            def runner(args, **kwargs):
                if args[1] == 'audit':
                    raise subprocess.CalledProcessError(1, args)
            with self.assertRaises(subprocess.CalledProcessError):
                audit_package(self.fixture(Path(directory)), runner)

    def test_success_uses_isolated_lock_without_repository_config_or_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.npmrc').write_text('synthetic-config-must-not-be-copied')
            calls = []
            def runner(args, **kwargs):
                calls.append(args)
                self.assertEqual({p.name for p in Path(kwargs['cwd']).iterdir()}, {'package.json', 'package-lock.json'})
                self.assertTrue(kwargs['check'])
            audit_package(self.fixture(root), runner)
            self.assertIn('--ignore-scripts', calls[0])
            self.assertIn('--include=dev', calls[1])

if __name__ == '__main__':
    unittest.main()
