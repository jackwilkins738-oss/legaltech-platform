import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {matchMatter} from '../src/matcher.js';
const matters=JSON.parse(fs.readFileSync(new URL('../fixtures/matters.json',import.meta.url),'utf8'));
const emails=fs.readFileSync(new URL('../fixtures/emails.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
test('exact references auto-match expected matter',()=>{
  for(const e of emails.filter(x=>x.mode==='EXACT').slice(0,20)){
    const r=matchMatter(e,matters); assert.equal(r.decision,'AUTO'); assert.equal(r.candidates[0].matter_id,e.expected_matter_id);
  }
});
test('conflicting references require review',()=>{
  for(const e of emails.filter(x=>x.mode==='CONFLICT')) assert.equal(matchMatter(e,matters).decision,'REVIEW');
});
test('adversarial content is blocked',()=>{
  for(const e of emails.filter(x=>x.mode==='ADVERSARIAL')) assert.equal(matchMatter(e,matters).decision,'BLOCK');
});
