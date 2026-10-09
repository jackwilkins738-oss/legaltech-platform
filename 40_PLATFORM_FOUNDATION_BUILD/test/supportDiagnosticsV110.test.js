import test from 'node:test';
import assert from 'node:assert/strict';
import {JitSupportAccessRegistry} from '../src/supportAccess.js';
import {SupportDiagnosticService} from '../src/supportDiagnostics.js';

const NOW=Date.parse('2027-05-01T12:00:00Z');
const H=n=>String(n).repeat(64).slice(0,64);
const session=(actor,caps,tenantId='ta')=>({tenantId,actorId:actor,sessionId:`s-${actor}`,capabilities:caps,roles:[],securityZoneIds:[],matterMembershipIds:[],documentAccessRefs:[],breakGlassGrants:[],authContext:{method:'SERVER_SESSION',mfaVerified:true,authTime:'2027-05-01T11:59:00Z',expiresAt:'2027-05-01T13:00:00Z',providerSessionId:`p-${actor}`}});
function fixture(scope='DIAGNOSTIC_READ',provider=async()=>({release:{applicationVersion:'0.10.65',releaseFingerprint:H(1),configFingerprint:H(2),schemaState:'HEALTHY'},readinessState:'HEALTHY',dependencies:[{kind:'DATABASE',state:'HEALTHY',failureCount:0},{kind:'GRAPH',state:'DEGRADED',failureCount:2}],queues:{pending:3,claimed:1,failed:0,oldestAgeSeconds:42},activeIncidentCount:0,tenantLifecycleState:'ACTIVE'})){
  const access=new JitSupportAccessRegistry({now:()=>NOW});
  const requester=session('support-a',['support:access:request']);
  const q=access.request({session:requester,scope,matterId:'m1',ticketRef:'SUP-110',purpose:'Investigate production health safely',traceId:'tr-r'});
  access.approve({session:session('security-b',['support:access:approve']),requestId:q.requestId,traceId:'tr-a'});
  return {access,requester,svc:new SupportDiagnosticService({supportAccess:access,provider,now:()=>NOW})};
}

test('V110 diagnostic snapshot requires exact DIAGNOSTIC_READ support grant',async()=>{const x=fixture('MATTER_READ');await assert.rejects(()=>x.svc.snapshot({session:x.requester,matterId:'m1',traceId:'t'}),/SUPPORT_ACCESS_UNAVAILABLE/);});
test('V110 diagnostic snapshot is tenant actor matter and current JIT grant bound',async()=>{const x=fixture();assert.equal((await x.svc.snapshot({session:x.requester,matterId:'m1',traceId:'t'})).readinessState,'HEALTHY');await assert.rejects(()=>x.svc.snapshot({session:x.requester,matterId:'m2',traceId:'x'}),/SUPPORT_ACCESS_UNAVAILABLE/);await assert.rejects(()=>x.svc.snapshot({session:session('support-a',['support:access:request'],'tb'),matterId:'m1',traceId:'x'}),/SUPPORT_ACCESS_UNAVAILABLE/);});
test('V110 raw provider errors never escape',async()=>{const x=fixture('DIAGNOSTIC_READ',async()=>{throw new Error('db-host.internal password=secret client-name');});await assert.rejects(()=>x.svc.snapshot({session:x.requester,matterId:'m1',traceId:'t'}),e=>e.message==='SUPPORT_DIAGNOSTIC_UNAVAILABLE');});
test('V110 arbitrary fields hostnames and raw error strings are structurally refused',async()=>{const x=fixture('DIAGNOSTIC_READ',async()=>({release:{applicationVersion:'0.10.65',releaseFingerprint:H(1),configFingerprint:H(2),schemaState:'HEALTHY'},readinessState:'HEALTHY',dependencies:[],queues:{},activeIncidentCount:0,tenantLifecycleState:'ACTIVE',rawError:'password=secret'}));await assert.rejects(()=>x.svc.snapshot({session:x.requester,matterId:'m1',traceId:'t'}),/FIELD_FORBIDDEN/);});
test('V110 dependencies use fixed kinds and bounded counts only',async()=>{const x=fixture('DIAGNOSTIC_READ',async()=>({release:{applicationVersion:'0.10.65',releaseFingerprint:H(1),configFingerprint:H(2),schemaState:'HEALTHY'},readinessState:'HEALTHY',dependencies:[{kind:'https://private-host',state:'HEALTHY',failureCount:0}],queues:{},activeIncidentCount:0,tenantLifecycleState:'ACTIVE'}));await assert.rejects(()=>x.svc.snapshot({session:x.requester,matterId:'m1',traceId:'t'}),/DEPENDENCY_INVALID/);});
test('V110 evidence stores only hashes and bounded operational identifiers',async()=>{const x=fixture();const out=await x.svc.snapshot({session:x.requester,matterId:'m1',traceId:'trace-110'}),json=JSON.stringify(x.svc.evidence('ta'));assert.equal(out.snapshotHash.length,64);assert.doesNotMatch(json,/support-a|m1/);assert.match(json,/snapshotHash/);});
test('V110 snapshot output contains no support ticket rationale or raw actor identity',async()=>{const x=fixture();const json=JSON.stringify(await x.svc.snapshot({session:x.requester,matterId:'m1',traceId:'t'}));assert.doesNotMatch(json,/SUP-110|Investigate production|support-a/);});
test('V110 existing MATTER_READ remains unable to authorize diagnostic snapshot',()=>{const x=fixture('MATTER_READ');assert.throws(()=>x.access.assertDiagnosticRead(x.requester,{matterId:'m1',traceId:'x'}),/UNAVAILABLE/);});
