import json
from pathlib import Path
from security_regression_scan import TEXT, SECRET_PATTERNS, scan_unpinned_actions
HERE=Path(__file__).resolve().parent
policy=json.loads((HERE/'security_policy.json').read_text())
def test_no_external_send_default(): assert policy['unsafe_env_defaults']['ALLOW_EXTERNAL_SEND']=='true'
def test_cross_tenant_required(): assert any('cross-tenant' in x for x in policy['required_test_concepts'])
def test_sensitive_tokens_present(): assert 'access_token' in policy['forbidden_log_keys'] and 'document_text' in policy['forbidden_log_keys']
def test_manifest_has_blockers():
 m=json.loads((HERE/'security_test_manifest.json').read_text()); assert len([x for x in m['mandatory_security_tests'] if x['severity']=='BLOCKER'])>=3
def test_private_key_file_types_are_scanned(): assert '.pem' in TEXT and '.key' in TEXT
def test_secret_scanner_covers_modern_provider_tokens():
 names={name for name,_ in SECRET_PATTERNS}; assert {'GITHUB_PAT_FINE_GRAINED','NPM_TOKEN','AZURE_STORAGE_KEY','DATABASE_URI_PASSWORD','PRIVATE_KEY'} <= names
def test_github_actions_are_immutable_sha_pinned(): assert scan_unpinned_actions()==[]

def test_production_identity_security_concepts_required():
 required=set(policy['required_test_concepts']); assert {'jwks','server session','session revocation','csrf','mfa step-up'} <= required
