import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {InMemoryAbuseLimiter} from '../src/abuseControl.js';
import {validateGraphNotificationBatch,assertLiveConnectorConfig,verifyGraphClientState} from '../src/connectorSecurity.js';
import {inspectFile,assertProductionFileEvidence,BASIC_INGEST_ACCEPTED} from '../src/fileSafety.js';
import {createApiServer} from '../src/httpApi.js';
import {StaticAuthProvider} from '../src/auth.js';

const here=path.dirname(fileURLToPath(import.meta.url));

function denied(fn,code){assert.throws(fn,e=>e.code===code||e.message===code);}

test('abuse limiter enforces independent IP and tenant budgets',()=>{
  let now=0;const limiter=new InMemoryAbuseLimiter({windowMs:1000,maxPerIp:2,maxPerTenant:2,now:()=>now});
  const req={socket:{remoteAddress:'127.0.0.1'}};const session={tenantId:'tenant-a'};
  limiter.checkIp(req);limiter.checkIp(req);denied(()=>limiter.checkIp(req),'RATE_LIMITED');
  limiter.checkTenant(session);limiter.checkTenant(session);denied(()=>limiter.checkTenant(session),'RATE_LIMITED');
  now=1001;assert.doesNotThrow(()=>limiter.checkIp(req));assert.doesNotThrow(()=>limiter.checkTenant(session));
});

test('Graph client-state comparison and batch parsing fail closed',()=>{
  assert.equal(verifyGraphClientState('secret-state','secret-state'),true);
  assert.equal(verifyGraphClientState('secret-state','other-state'),false);
  const batch={value:[{subscriptionId:'sub-1',resource:'users/x/messages/y',changeType:'updated',clientState:'secret-state'}]};
  assert.equal(validateGraphNotificationBatch(batch,{expectedClientState:'secret-state'}).length,1);
  denied(()=>validateGraphNotificationBatch({value:[{...batch.value[0],clientState:'wrong'}]},{expectedClientState:'secret-state'}),'NOT_FOUND');
  denied(()=>validateGraphNotificationBatch({value:Array.from({length:3},()=>batch.value[0])},{expectedClientState:'secret-state',maxItems:2}),'INVALID_REQUEST');
});

test('live connector configuration requires secret references and least privilege',()=>{
  assert.equal(assertLiveConnectorConfig({mode:'LIVE',credentialRef:'secret://graph/tenant-a',capabilities:['MAILBOX_ALLOWLIST_READ']},{kind:'MICROSOFT_GRAPH'}),true);
  denied(()=>assertLiveConnectorConfig({mode:'LIVE',credentialRef:'plaintext-secret-value',capabilities:['MAILBOX_ALLOWLIST_READ']},{kind:'MICROSOFT_GRAPH'}),'LIVE_CONNECTOR_CONFIGURATION_INVALID');
  denied(()=>assertLiveConnectorConfig({mode:'LIVE',credentialRef:'secret://graph/a',capabilities:['MAILBOX_ALL']},{kind:'MICROSOFT_GRAPH'}),'LIVE_CONNECTOR_CONFIGURATION_INVALID');
  denied(()=>assertLiveConnectorConfig({mode:'LIVE',credentialRef:'secret://proclaim/a',capabilities:['WRITE']},{kind:'PROCLAIM'}),'LIVE_CONNECTOR_CONFIGURATION_INVALID');
  assert.equal(assertLiveConnectorConfig({mode:'LIVE',credentialRef:'secret://proclaim/a',capabilities:['READ_BACK','WRITE']},{kind:'PROCLAIM'}),true);
});

test('basic file gate never claims malware or parser safety',()=>{
  const result=inspectFile({filename:'evidence.pdf',bytes:Buffer.from('%PDF synthetic')});
  assert.equal(result.verdict,BASIC_INGEST_ACCEPTED);assert.equal(result.productionReady,false);assert.notEqual(result.verdict,'SAFE_FOR_PARSER');
});

test('production file evidence requires clean scan plus isolated parsing',()=>{
  const base={basicVerdict:BASIC_INGEST_ACCEPTED,malwareScan:'CLEAN',parserIsolation:'ISOLATED',scannedAt:'2026-10-08T12:00:00Z',scannerRef:'managed-av/scan-1'};
  assert.equal(assertProductionFileEvidence(base),true);
  for(const patch of [{malwareScan:'UNKNOWN'},{parserIsolation:'SHARED'},{scannerRef:''},{scannedAt:'bad'}]) assert.throws(()=>assertProductionFileEvidence({...base,...patch}),/PRODUCTION_FILE_EVIDENCE_REQUIRED/);
});

async function withServer(t,{abuseLimiter}={}){
  let matterLimit=null;
  const platform={listMatters(_tenant,limit){matterLimit=limit;return [{id:'m1',tenantId:'tenant-a'}];}};
  const authProvider=new StaticAuthProvider([{token:'synthetic',tenantId:'tenant-a',actorId:'user-a',capabilities:['matter:read']}]);
  const server=createApiServer({platform,authProvider,abuseLimiter});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  return {base:`http://127.0.0.1:${server.address().port}`,getLimit:()=>matterLimit};
}

test('client trace header cannot control forensic trace identity',async t=>{
  const {base}=await withServer(t);
  const r=await fetch(base+'/api/v1/matters',{headers:{authorization:'Bearer synthetic','x-trace-id':'attacker-owned-trace'}});
  assert.equal(r.status,200);const serverTrace=r.headers.get('x-trace-id');assert.match(serverTrace,/^trc_[0-9a-f-]{36}$/);assert.notEqual(serverTrace,'attacker-owned-trace');
});

test('collection pagination is bounded and malformed limits are rejected',async t=>{
  const {base,getLimit}=await withServer(t);
  let r=await fetch(base+'/api/v1/matters?limit=9999',{headers:{authorization:'Bearer synthetic'}});assert.equal(r.status,200);assert.equal(getLimit(),200);
  r=await fetch(base+'/api/v1/matters?limit=0',{headers:{authorization:'Bearer synthetic'}});assert.equal(r.status,400);assert.equal((await r.json()).code,'INVALID_REQUEST');
});

test('HTTP abuse limiter returns stable 429 before repeated unauthenticated work',async t=>{
  const limiter=new InMemoryAbuseLimiter({maxPerIp:2,maxPerTenant:100});const {base}=await withServer(t,{abuseLimiter:limiter});
  assert.equal((await fetch(base+'/api/v1/health')).status,200);assert.equal((await fetch(base+'/api/v1/health')).status,200);
  const r=await fetch(base+'/api/v1/health');assert.equal(r.status,429);assert.equal((await r.json()).code,'RATE_LIMITED');
});

test('synthetic development server refuses implicit startup',()=>{
  const child=spawnSync(process.execPath,['src/devServer.js'],{cwd:path.resolve(here,'..'),env:{...process.env,LEGALTECH_ENABLE_SYNTHETIC_DEV_SERVER:''},encoding:'utf8',timeout:5000});
  assert.notEqual(child.status,0);assert.match(`${child.stdout}\n${child.stderr}`,/LEGALTECH_ENABLE_SYNTHETIC_DEV_SERVER=true/);
});
