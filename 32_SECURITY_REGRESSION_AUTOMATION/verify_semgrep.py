"""Prove both language scanners detect insecure fixtures and accept safe source."""
import json
from pathlib import Path
import subprocess
import tempfile

rules = Path(__file__).parent / 'semgrep' / 'ci-rules.json'
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / 'fixture.js').write_text('const jwt = require("jsonwebtoken");\njwt.sign({sub:"synthetic"}, "synthetic-ci-only");\n')
    (root / 'fixture.py').write_text('from Crypto.Cipher import DES\nDES.new(b"synthetic", DES.MODE_ECB)\n')
    (root / 'safe.js').write_text('const crypto = require("node:crypto");\ncrypto.randomBytes(32);\n')
    (root / 'safe.py').write_text('import secrets\nsecrets.token_bytes(32)\n')
    result = subprocess.run(['semgrep', 'scan', '--config', str(rules.resolve()), '--metrics=off',
        '--disable-version-check', '--error', '--strict', '--no-git-ignore', '--json', str(root)],
        capture_output=True, text=True, timeout=60)
    report = json.loads(result.stdout)
    ids = {finding['check_id'] for finding in report.get('results', [])}
    expected = {'javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret',
                'python.pycryptodome.security.insecure-cipher-algorithm-des.insecure-cipher-algorithm-des'}
    if result.returncode != 1 or report.get('errors') or not all(any(i.endswith(e) for i in ids) for e in expected):
        raise RuntimeError('Scanner failed to block insecure JavaScript/Python fixtures')
    if any(Path(finding['path']).name.startswith('safe.') for finding in report['results']):
        raise RuntimeError('Safe fixture unexpectedly blocked')
print('Both language scanners block insecure fixtures and accept safe fixtures')
