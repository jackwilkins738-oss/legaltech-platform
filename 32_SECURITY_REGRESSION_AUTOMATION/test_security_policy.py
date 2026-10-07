import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
policy=json.loads((HERE/'security_policy.json').read_text())
def test_no_external_send_default(): assert policy['unsafe_env_defaults']['ALLOW_EXTERNAL_SEND']=='true'
def test_cross_tenant_required(): assert any('cross-tenant' in x for x in policy['required_test_concepts'])
def test_sensitive_tokens_present(): assert 'access_token' in policy['forbidden_log_keys'] and 'document_text' in policy['forbidden_log_keys']
def test_manifest_has_blockers():
 m=json.loads((HERE/'security_test_manifest.json').read_text()); assert len([x for x in m['mandatory_security_tests'] if x['severity']=='BLOCKER'])>=3
