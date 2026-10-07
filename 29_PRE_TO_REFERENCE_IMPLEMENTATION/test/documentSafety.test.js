import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectUpload } from '../src/documentSafety.js';

test('renamed Windows executable is quarantined',()=>{
  const r=inspectUpload({filename:'report.pdf',bytes:Buffer.from([0x4d,0x5a,0x90,0,0])});
  assert.equal(r.verdict,'QUARANTINE');
});

test('ordinary synthetic PDF bytes are allowed to parser stage',()=>{
  const r=inspectUpload({filename:'report.pdf',bytes:Buffer.from('%PDF-1.7 synthetic')});
  assert.equal(r.verdict,'SAFE_FOR_PARSER');
});
