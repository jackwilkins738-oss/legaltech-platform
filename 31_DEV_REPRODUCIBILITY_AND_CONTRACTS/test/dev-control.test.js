import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const scripts=path.resolve(here,'../scripts');
function run(name){return execFileSync(process.execPath,[path.join(scripts,name)],{encoding:'utf8'});}
test('repo verification passes',()=>{const r=JSON.parse(run('verify-repo.mjs'));assert.equal(r.ok,true);});
test('contract verification passes',()=>{const r=JSON.parse(run('verify-contracts.mjs'));assert.equal(r.ok,true);});
test('dev check passes',()=>{const r=JSON.parse(run('dev-check.mjs'));assert.equal(r.ok,true);});
test('reset and seed are deterministic',()=>{run('reset-reference.mjs');const a=JSON.parse(run('seed-reference.mjs'));const b=JSON.parse(run('seed-reference.mjs'));assert.equal(a.matters,2);assert.equal(b.matters,2);assert.equal(a.path,b.path);});
test('admin surface labels itself synthetic',()=>{const h=fs.readFileSync(path.resolve(here,'../ui/index.html'),'utf8');assert.match(h,/Synthetic development environment only/);assert.match(h,/No customer data/);});
