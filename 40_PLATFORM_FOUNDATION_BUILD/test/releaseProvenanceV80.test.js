import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {fingerprintSafeConfig,configFingerprintMatches,buildReleaseProvenance,releaseMatches,createReleaseReadinessProbe,assessFleetProvenance} from '../src/releaseProvenance.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const base=()=>({releaseId:'release-80',version:'0.10.35',sourceRevision:'a'.repeat(40),artifactSha256:'b'.repeat(64),migrationManifestSha256:'c'.repeat(64),configFingerprint:'d'.repeat(64)});

test('V80 safe configuration fingerprint ignores unrelated secrets and raw values never leave the function',()=>{
  const env={AUTH_MODE:'oidc',SECRET_STORE_MODE:'managed',DATABASE_URL:'postgresql://secret-value',CLIENT_SECRET:'do-not-hash'};
  const one=fingerprintSafeConfig(env);const two=fingerprintSafeConfig({...env,DATABASE_URL:'changed-secret',CLIENT_SECRET:'changed'});
  assert.equal(one,two);assert.match(one,/^[a-f0-9]{64}$/);assert.equal(one.includes('secret'),false);
});

test('V80 security-relevant configuration change changes the fingerprint',()=>{
  const a=fingerprintSafeConfig({AUTH_MODE:'oidc',SECRET_STORE_MODE:'managed'}),b=fingerprintSafeConfig({AUTH_MODE:'oidc',SECRET_STORE_MODE:'local'});assert.notEqual(a,b);
});

test('V80 configured fingerprint comparison fails on security configuration drift',()=>{
  const env={AUTH_MODE:'oidc',SECRET_STORE_MODE:'managed',READINESS_FAILURE_MODE:'fail-closed'};const expected=fingerprintSafeConfig(env);
  assert.equal(configFingerprintMatches(env,expected),true);assert.equal(configFingerprintMatches({...env,READINESS_FAILURE_MODE:'fail-open'},expected),false);assert.equal(configFingerprintMatches(env,'bad'),false);
});

test('V80 release descriptor is pinned to build source artifact schema and config identity',()=>{
  const row=buildReleaseProvenance(base());assert.match(row.releaseFingerprint,/^[a-f0-9]{64}$/);assert.equal(row.releaseId,'release-80');
  for(const patch of [{sourceRevision:'bad'},{artifactSha256:'0'.repeat(63)},{migrationManifestSha256:'x'.repeat(64)},{configFingerprint:'nope'},{releaseId:'bad release id'}])assert.throws(()=>buildReleaseProvenance({...base(),...patch}),/PROVENANCE_/);
});

test('V80 exact provenance comparison fails for any drifted component',()=>{
  const expected=base();assert.equal(releaseMatches(expected,expected),true);assert.equal(releaseMatches(expected,{...expected,artifactSha256:'e'.repeat(64)}),false);assert.equal(releaseMatches(expected,{...expected,configFingerprint:'e'.repeat(64)}),false);
});

test('V80 readiness reports only bounded release state',async()=>{
  const expected=base();
  assert.deepEqual(await createReleaseReadinessProbe({expected,getCurrent:async()=>expected})(),{ok:true,code:'RELEASE_CURRENT'});
  assert.deepEqual(await createReleaseReadinessProbe({expected,getCurrent:async()=>({...expected,sourceRevision:'f'.repeat(40)})})(),{ok:false,code:'RELEASE_DRIFT'});
  assert.deepEqual(await createReleaseReadinessProbe({expected,getCurrent:async()=>{throw new Error('internal deployment secret');}})(),{ok:false,code:'RELEASE_PROVENANCE_INVALID'});
});

test('V80 fleet provenance distinguishes mixed release from configuration drift',()=>{
  const r1='1'.repeat(64),r2='2'.repeat(64),c1='3'.repeat(64),c2='4'.repeat(64);
  assert.equal(assessFleetProvenance([{instanceId:'i-1',releaseFingerprint:r1,configFingerprint:c1},{instanceId:'i-2',releaseFingerprint:r1,configFingerprint:c1}]).status,'CONSISTENT');
  assert.equal(assessFleetProvenance([{instanceId:'i-1',releaseFingerprint:r1,configFingerprint:c1},{instanceId:'i-2',releaseFingerprint:r1,configFingerprint:c2}]).status,'CONFIG_DRIFT');
  assert.equal(assessFleetProvenance([{instanceId:'i-1',releaseFingerprint:r1,configFingerprint:c1},{instanceId:'i-2',releaseFingerprint:r2,configFingerprint:c1}]).status,'MIXED_RELEASE');
});

test('V80 migration manifest digest can bind the deployed release without exposing manifest contents',()=>{
  const bytes=fs.readFileSync(new URL('../../30_PRODUCTION_SHAPE_SCAFFOLD/db/migrations/MANIFEST.json',import.meta.url));const manifestSha=digest(bytes);const row=buildReleaseProvenance({...base(),migrationManifestSha256:manifestSha});assert.equal(row.migrationManifestSha256,manifestSha);assert.equal(JSON.stringify(row).includes('017_data_lifecycle.sql'),false);
});

test('V80 malformed fleet reports fail closed rather than accepting ambiguous identity',()=>{
  assert.throws(()=>assessFleetProvenance([]),/PROVENANCE_FLEET_INVALID/);
  assert.throws(()=>assessFleetProvenance([{instanceId:'bad id',releaseFingerprint:'1'.repeat(64),configFingerprint:'2'.repeat(64)}]),/PROVENANCE_INSTANCE_INVALID/);
  assert.throws(()=>assessFleetProvenance([{instanceId:'i-1',releaseFingerprint:'bad',configFingerprint:'2'.repeat(64)}]),/PROVENANCE_RELEASE_FINGERPRINT_INVALID/);
});
