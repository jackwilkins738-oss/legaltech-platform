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


def test_hostile_document_security_concepts_required():
 required=set(policy['required_test_concepts']); assert {'mime signature','decompression bomb','isolated parser','quarantine storage','document security pipeline'} <= required

def test_connector_secret_containment_concepts_required():
 required=set(policy['required_test_concepts']); assert {'managed secret','credential containment','credential rotation','credential revocation','workload identity','secret egress','durable credential generation'} <= required
 assert {'client_secret','api_key','private_key'} <= set(policy['forbidden_log_keys'])


def test_security_monitoring_concepts_required():
 required=set(policy['required_test_concepts']); assert {'tamper-evident audit','security alert sink','bulk exfiltration','session anomaly','break-glass alert','connector abuse','security retention','incident correlation'} <= required
 assert {'ip_address','user_agent','session_cookie'} <= set(policy['forbidden_log_keys'])


def test_readiness_security_concepts_required():
 required=set(policy['required_test_concepts']); assert {'liveness readiness separation','readiness fails closed','readiness error redaction','bounded readiness probing'} <= required


def test_migration_release_integrity_concepts_required():
 required=set(policy['required_test_concepts']); assert {'migration checksum pinning','migration sequence integrity','destructive migration review','schema readiness gate'} <= required


def test_authenticated_read_containment_concepts_required():
 required=set(policy['required_test_concepts']); assert {'authenticated read volume limit','distinct matter read budget','work queue read monitoring','read egress fails closed'} <= required


def test_data_lifecycle_concepts_required():
 required=set(policy['required_test_concepts']); assert {'versioned retention policy','legal hold fail closed','dual-control disposition','no automatic deletion'} <= required


def test_release_provenance_concepts_required():
 required=set(policy['required_test_concepts']); assert {'release provenance binding','safe config fingerprint','release drift readiness','fleet config drift'} <= required


def test_controlled_export_concepts_required():
 required=set(policy['required_test_concepts']); assert {'controlled export authorization','export single-use grant','export storage isolation','no public export link','export event append-only'} <= required


def test_security_interlock_concepts_required():
 required=set(policy['required_test_concepts']); assert {'security interlock fail closed','dual-control interlock release','egress kill switch','interlock tenant binding','interlock event append-only'} <= required

def test_v83_change_control_concepts():
 required=set(policy['required_test_concepts']); assert {'production change dual control','change approval hash binding','change approval single use','change event append-only','workflow publish approval'} <= required


def test_v84_worker_execution_concepts():
 required=set(policy['required_test_concepts']); assert {'worker execution exact binding','worker execution single use','worker execution workload identity','worker execution append-only evidence'} <= required

def test_v85_audit_checkpoint_concepts():
 required=set(policy['required_test_concepts']); assert {'audit external checkpoint','audit rollback detection','audit checkpoint immutable'} <= required

def test_v86_document_delivery_concepts():
 required=set(policy['required_test_concepts']); assert {'document delivery current authorization','document delivery single use','document delivery storage reference containment','document delivery interlock'} <= required

def test_v87_key_lifecycle_concepts():
 required=set(policy['required_test_concepts']); assert {'managed envelope encryption','key generation pinning','key rotation monotonic','key material non-persistence'} <= required

def test_v88_jit_support_access_concepts():
 required=set(policy['required_test_concepts']); assert {'jit support access','support access dual control','support access resource binding','support access append-only','no standing support admin'} <= required

def test_v89_graph_webhook_ingress_concepts():
 required=set(policy['required_test_concepts']); assert {'graph webhook clientState','graph webhook server tenant resolution','graph rich notification token verification','graph webhook durable replay','graph webhook validate before dispatch'} <= required


def test_v90_graph_subscription_lifecycle_concepts():
 required=set(policy['required_test_concepts']); assert {'graph subscription server registry','graph subscription managed clientState','graph subscription lifecycle recovery','graph subscription mutation separation','graph subscription generation monotonic'} <= required


def test_v91_graph_webhook_queue_concepts():
 required=set(policy['required_test_concepts']); assert {'graph webhook managed queue','graph webhook lease recovery','graph webhook retry safe dispatch','graph webhook ephemeral payload','graph webhook idempotent downstream'} <= required


def test_v92_graph_delta_recovery_concepts():
 required=set(policy['required_test_concepts']); assert {'graph delta opaque checkpoint','graph delta origin pinning','graph delta bounded recovery','graph delta recovery before reactivation','graph delta checkpoint secret'} <= required
