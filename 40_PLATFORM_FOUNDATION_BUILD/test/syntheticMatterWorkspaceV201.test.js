import test from 'node:test';
import assert from 'node:assert/strict';
import {SyntheticMatterWorkspace} from '../src/syntheticMatterWorkspace.js';
const tenant='tenant-a',other='tenant-b';
const data=[
  {id:'public',tenantId:tenant,visibility:'STANDARD',clientLabel:'Public case'},
  {id:'private',tenantId:tenant,visibility:'PRIVATE',clientLabel:'Restricted case'},
  {id:'zone',tenantId:tenant,visibility:'SECURITY_ZONE',securityZoneId:'secure',clientLabel:'Protected case'},
  {id:'external',tenantId:other,visibility:'STANDARD',clientLabel:'Other tenant'}
];
const store={
  getMatter(t,id){return data.find(x=>x.tenantId===t&&x.id===id)??null;},
  listMatters(t){return data.filter(x=>x.tenantId===t);},
  listWork(){throw Error('work should not be exposed');},
  listEvents(){throw Error('events should not be exposed');}
};
const session=(more={})=>({tenantId:tenant,actorId:'alice',capabilities:['matter:read'],roles:[],...more});
test('V201 workspace lists only visible matters; restricted membership and zone enforced',()=>{
  const w=new SyntheticMatterWorkspace({store});
  assert.deepEqual(w.list({session:session()}).map(m=>m.id),['public']);
  assert.deepEqual(w.list({session:session({matterMembershipIds:['private','zone'],securityZoneIds:['secure']})}).map(m=>m.id),['public','private','zone']);
  assert.throws(()=>w.get({session:session(),matterId:'private'}),{code:'NOT_FOUND'});
  assert.throws(()=>w.get({session:session(),matterId:'external'}),{code:'NOT_FOUND'});
  assert.throws(()=>w.get({session:session({tenantId:other}),matterId:'private'}),{code:'NOT_FOUND'});
});
test('V201 workspace denies missing read capability and unsafe input',()=>{
  const w=new SyntheticMatterWorkspace({store});
  assert.throws(()=>w.list({session:session({capabilities:[]})}),{code:'NOT_FOUND'});
  assert.throws(()=>w.list({session:session(),limit:1000}),{code:'INVALID_REQUEST'});
  assert.throws(()=>w.get({session:session(),matterId:''}),{code:'NOT_FOUND'});
});
test('V201 workspace returns disconnected objects and never reveals work or event counts',()=>{
  const w=new SyntheticMatterWorkspace({store});
  const m=w.get({session:session(),matterId:'public'});
  assert.throws(()=>{m.clientLabel='altered';},TypeError);
  assert.equal(data[0].clientLabel,'Public case');
  const overview=w.summary({session:session(),matterId:'public'});
  assert.equal(overview.syntheticReferenceOnly,true);
  assert.equal(overview.workAndEventsRequireSeparateAuthorization,true);
  assert.equal(Object.hasOwn(overview,'workCount'),false);
  assert.equal(Object.hasOwn(overview,'events'),false);
});
