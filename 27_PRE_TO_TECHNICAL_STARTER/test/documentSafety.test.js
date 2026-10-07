import test from 'node:test'; import assert from 'node:assert/strict'; import {inspectDocument} from '../src/documentSafety.js';
test('renamed executable is quarantined by signature',()=>{
  const r=inspectDocument({filename:'innocent.pdf',bytes:Buffer.from([0x4d,0x5a,0,0,0])}); assert.equal(r.state,'QUARANTINE'); assert.equal(r.reason,'EXECUTABLE_SIGNATURE');
});
test('ordinary bytes proceed only to next safety stage',()=>{
  const r=inspectDocument({filename:'doc.pdf',bytes:Buffer.from('%PDF-1.7')}); assert.equal(r.state,'SAFE_FOR_NEXT_STAGE');
});
