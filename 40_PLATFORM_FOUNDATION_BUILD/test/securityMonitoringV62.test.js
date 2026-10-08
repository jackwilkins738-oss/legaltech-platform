import test from 'node:test';
import assert from 'node:assert/strict';
import {PlatformStore} from '../src/store.js';
import {SecurityMonitor,verifyAuditChainEntries} from '../src/securityMonitoring.js';
import {Platform} from '../src/platform.js';

function fixture(options={}){
  const store=new PlatformStore(':memory:',{matters:[{id:'m1',tenantId:'ta',externalId:'P1',externalRefs:['R1']},{id:'m2',tenantId:'ta',externalId:'P2',externalRefs:['R2']},{id:'m3',tenantId:'ta',externalId:'P3',externalRefs:['R3']}]});
  const monitor=new SecurityMonitor({store,...options});store.attachSecurityMonitor(monitor);
  return {store,monitor,close:()=>store.close()};
}
const session=(more={})=>({tenantId:'ta',actorId:'u1',sessionId:'s1',capabilities:[],breakGlassGrants:[],...more});

test('audit ledger is hash chained and self-verifies',()=>{const x=fixture();try{x.store.audit({tenantId:'ta',traceId:'tr1',action:'A',objectId:'o1',outcome:'SUCCESS'});x.store.audit({tenantId:'ta',traceId:'tr2',action:'B',objectId:'o2',outcome:'SUCCESS'});const items=x.store.listAudits('ta');assert.equal(x.store.verifyAuditChain('ta'),true);assert.equal(items[0].previousHash,'0'.repeat(64));assert.equal(items[1].previousHash,items[0].entryHash);assert.match(items[1].entryHash,/^[a-f0-9]{64}$/);}finally{x.close();}});

test('audit chain verifier detects modified historical evidence',()=>{const x=fixture();try{x.store.audit({tenantId:'ta',traceId:'tr1',action:'A',objectId:'o1',outcome:'SUCCESS'});const items=x.store.listAudits('ta');assert.equal(verifyAuditChainEntries(items),true);items[0]={...items[0],outcome:'FAILED'};assert.equal(verifyAuditChainEntries(items),false);}finally{x.close();}});

test('local audit and security alert ledgers reject mutation and deletion',()=>{const x=fixture();try{x.store.audit({tenantId:'ta',traceId:'tr1',action:'A',objectId:'o1',outcome:'SUCCESS'});x.store.securityAlert({tenantId:'ta',incidentId:'inc_1',type:'BULK_READ',severity:'HIGH',traceId:'tr2',actorId:'u1',sessionId:'s1',matterId:null,action:'READ',contextHash:null});assert.throws(()=>x.store.db.prepare("UPDATE audits SET trace_id='evil'").run(),/append-only/);assert.throws(()=>x.store.db.prepare('DELETE FROM audits').run(),/append-only/);assert.throws(()=>x.store.db.prepare('DELETE FROM security_alerts').run(),/append-only/);}finally{x.close();}});

test('successful privileged connector action emits a security alert',()=>{const x=fixture();try{x.store.audit({tenantId:'ta',traceId:'tr1',actorId:'u1',action:'GRAPH_SUBSCRIPTION_CREATE',objectId:'MICROSOFT_GRAPH',outcome:'SUCCESS'});const alerts=x.store.listSecurityAlerts('ta');assert.equal(alerts.length,1);assert.equal(alerts[0].type,'PRIVILEGED_ACTION');assert.equal(alerts[0].action,'GRAPH_SUBSCRIPTION_CREATE');}finally{x.close();}});

test('connector failure burst emits one high severity incident signal',()=>{let now=1_000_000;const x=fixture({now:()=>now,connectorFailureThreshold:3});try{for(let i=0;i<4;i++)x.store.audit({tenantId:'ta',traceId:`tr${i}`,actorId:'u1',action:'GRAPH_DELIVERY_FAIL',objectId:'MICROSOFT_GRAPH',outcome:'FAILED'});const hits=x.store.listSecurityAlerts('ta').filter(a=>a.type==='CONNECTOR_FAILURE_BURST');assert.equal(hits.length,1);assert.equal(hits[0].severity,'HIGH');}finally{x.close();}});

test('session context changes are detected without persisting raw network or user agent data',()=>{let now=1_000_000;const x=fixture({now:()=>now});try{const s=session();x.monitor.observeRequest({session:s,traceId:'tr1',req:{socket:{remoteAddress:'10.1.1.1'},headers:{'user-agent':'Agent A'}}});now+=1000;x.monitor.observeRequest({session:s,traceId:'tr2',req:{socket:{remoteAddress:'10.1.1.2'},headers:{'user-agent':'Agent B'}}});const alert=x.store.listSecurityAlerts('ta').find(a=>a.type==='SESSION_CONTEXT_CHANGED');assert.ok(alert);assert.match(alert.contextHash,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(alert).includes('10.1.1.2'),false);assert.equal(JSON.stringify(alert).includes('Agent B'),false);}finally{x.close();}});

test('bulk reads create an exfiltration signal once per window',()=>{const x=fixture({bulkReadThreshold:5});try{const s=session();x.monitor.observeRead({session:s,traceId:'tr1',resource:'matters',count:3});x.monitor.observeRead({session:s,traceId:'tr2',resource:'matters',count:2});x.monitor.observeRead({session:s,traceId:'tr3',resource:'matters',count:20});assert.equal(x.store.listSecurityAlerts('ta').filter(a=>a.type==='BULK_READ').length,1);}finally{x.close();}});

test('unusual cross-matter access is detected from distinct matter IDs',()=>{const x=fixture({crossMatterThreshold:3});try{const s=session();for(const id of ['m1','m2','m3'])x.monitor.observeMatterAccess({session:s,traceId:`tr-${id}`,matter:{tenantId:'ta',id}});const alerts=x.store.listSecurityAlerts('ta').filter(a=>a.type==='CROSS_MATTER_ACCESS');assert.equal(alerts.length,1);assert.equal(alerts[0].severity,'HIGH');}finally{x.close();}});

test('active break-glass use always emits a critical security alert bound to the matter',()=>{const now=1_000_000;const x=fixture({now:()=>now});try{const s=session({capabilities:['matter:break_glass'],breakGlassGrants:[{grantId:'g1',matterId:'m1',reason:'urgent client protection',issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60_000).toISOString(),stepUpVerified:true}]});x.monitor.observeMatterAccess({session:s,traceId:'tr-bg',matter:{tenantId:'ta',id:'m1'}});const alert=x.store.listSecurityAlerts('ta').find(a=>a.type==='BREAK_GLASS_USED');assert.ok(alert);assert.equal(alert.severity,'CRITICAL');assert.equal(alert.matterId,'m1');}finally{x.close();}});

test('central alert sink failure propagates instead of silently losing a security signal',()=>{const store=new PlatformStore(':memory:');const monitor=new SecurityMonitor({store,alertSink:{emit(){throw new Error('SINK_DOWN');}}});store.attachSecurityMonitor(monitor);try{assert.throws(()=>store.audit({tenantId:'ta',traceId:'tr1',actorId:'u1',action:'PROCLAIM_VALIDATION_RUN',objectId:'PROCLAIM',outcome:'SUCCESS'}),/SINK_DOWN/);}finally{store.close();}});


test('production-shaped platform can require a central security alert sink',()=>{const store=new PlatformStore(':memory:');try{assert.throws(()=>new Platform({store,objectStorage:{},aiGateway:{},proclaim:{},requireSecurityAlertSink:true}),/SECURITY_ALERT_SINK_REQUIRED/);}finally{store.close();}});
