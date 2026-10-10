"""Audit tracked Node manifests; reject missing/stale locks and unsupported ecosystems."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

SECTIONS = ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies')

def audit_package(manifest, runner=subprocess.run):
    data = json.loads(manifest.read_text())
    deps = {k: data.get(k, {}) for k in SECTIONS if data.get(k)}
    if not deps:
        print(f'{manifest}: no external dependencies')
        return
    lock = manifest.with_name('package-lock.json')
    if not lock.is_file():
        raise RuntimeError(f'{manifest}: committed package-lock.json required')
    locked = json.loads(lock.read_text())
    root = locked.get('packages', {}).get('')
    if locked.get('lockfileVersion') not in (2, 3) or not isinstance(root, dict):
        raise RuntimeError(f'{manifest}: unsupported lockfile')
    if any(root.get(k, {}) != data.get(k, {}) for k in SECTIONS):
        raise RuntimeError(f'{manifest}: lockfile does not match declared dependencies')
    with tempfile.TemporaryDirectory() as directory:
        shutil.copyfile(manifest, Path(directory) / 'package.json')
        shutil.copyfile(lock, Path(directory) / 'package-lock.json')
        # No repository scripts/configuration/credentials are executed or copied.
        for args in (
            ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'],
            ['npm', 'audit', '--audit-level=high', '--include=dev', '--registry=https://registry.npmjs.org'],
        ):
            runner(args, cwd=directory, check=True, timeout=180)
    print(f'{manifest}: locked dependency audit passed')

def main():
    root = Path(__file__).resolve().parents[1]
    files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    unsupported = [p for p in files if Path(p).name in ('pyproject.toml', 'Pipfile', 'poetry.lock', 'yarn.lock', 'pnpm-lock.yaml')
                   or Path(p).name.startswith('requirements')]
    if unsupported:
        raise RuntimeError('Additional dependency ecosystem requires audit coverage: ' + ', '.join(unsupported))
    manifests = [root / p for p in files if Path(p).name == 'package.json']
    if not manifests:
        raise RuntimeError('No tracked package manifests found')
    for manifest in manifests:
        audit_package(manifest)
    print(f'Audited {len(manifests)} tracked Node manifests')

if __name__ == '__main__':
    main()
