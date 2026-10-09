import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TO_FIELD_COLUMNS,toFieldTemplate} from '../src/toFieldIntake.js';
const cli=fileURLToPath(new URL('../src/toFieldCli.js',import.meta.url));
const observation={record_type:'OBSERVATION',participant_alias:'P-01',role_code:'LEGAL_ADMIN',task_family:'TEST_TASK',source_type:'DIRECT_OBSERVATION',timing_basis:'MEASURED',observed_at:'2026-10-09T08:00:00Z',active_ms:'60000'};
const csv=rows=>toFieldTemplate()+rows.map(r=>TO_FIELD_COLUMNS.map(k=>r[k]??'').join(',')).join('\n')+'\n';
function fixture(t,body=csv([observation])){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'to-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const input=path.join(dir,'input.csv'),out=path.join(dir,'out.json');fs.writeFileSync(input,body);
  const run=(command,extra=[])=>spawnSync(process.execPath,[cli,command,'--csv',input,'--out',out,...extra],{encoding:'utf8'});
  return {dir,input,out,run};
}
test('CLI template uses canonical columns and refuses overwrite',t=>{const x=fixture(t);const run=()=>spawnSync(process.execPath,[cli,'template','--out',x.out],{encoding:'utf8'});assert.equal(run().status,0);assert.equal(fs.readFileSync(x.out,'utf8'),toFieldTemplate());assert.equal(run().status,1);assert.equal(fs.readFileSync(x.out,'utf8'),toFieldTemplate());});
test('preflight emits counts and row codes without source notes or aliases',t=>{const x=fixture(t,csv([{...observation,process_note:'jane@example.com'}]));const r=x.run('preflight');assert.equal(r.status,2);const result=fs.readFileSync(x.out,'utf8');assert.equal(result.includes('jane@example.com'),false);assert.equal(result.includes('P-01'),false);assert.deepEqual(JSON.parse(result).issues,[{rowNumber:2,code:'TO_PROCESS_NOTE_UNSAFE'}]);});
test('report keeps baseline gates and leaves input untouched',t=>{const body=csv([observation]),x=fixture(t,body);assert.equal(x.run('report',['--working-days','220']).status,0);const r=JSON.parse(fs.readFileSync(x.out,'utf8'));assert.equal(r.quality.measuredSamples,1);assert.equal(r.annualisation[0].annualisable,false);assert.equal(r.workingDays,220);assert.equal(fs.readFileSync(x.input,'utf8'),body);assert.ok(r.limitations.some(s=>s.includes('not staff labour')));assert.equal(JSON.stringify(r).includes('P-01'),false);});
test('invalid mixed input refuses partial report and creates no output',t=>{const x=fixture(t,csv([observation,{...observation,source_type:'INTERVIEW'}]));const r=x.run('report',['--working-days','220']);assert.equal(r.status,2);assert.equal(fs.existsSync(x.out),false);assert.equal(JSON.parse(r.stderr.split('\n').find(l=>l.startsWith('{'))).rejectedRows,1);});
test('report refuses empty evidence and implicit working days',t=>{const x=fixture(t,toFieldTemplate());assert.equal(x.run('report').status,1);assert.match(x.run('report').stderr,/TO_CLI_WORKING_DAYS_REQUIRED/);assert.match(x.run('report',['--working-days','220']).stderr,/TO_CLI_EVIDENCE_EMPTY/);assert.equal(fs.existsSync(x.out),false);});
test('oversize and malformed UTF-8 inputs fail with bounded codes',t=>{const x=fixture(t,Buffer.alloc(2_000_001));assert.match(x.run('preflight').stderr,/TO_CLI_INPUT_SIZE_INVALID/);fs.writeFileSync(x.input,Buffer.from([0xff]));assert.match(x.run('preflight').stderr,/TO_CLI_ENCODING_INVALID/);assert.equal(fs.existsSync(x.out),false);});
test('report output is reproducible across independent runs',t=>{const x=fixture(t);assert.equal(x.run('report',['--working-days','230']).status,0);const first=fs.readFileSync(x.out,'utf8');fs.unlinkSync(x.out);assert.equal(x.run('report',['--working-days','230']).status,0);assert.equal(fs.readFileSync(x.out,'utf8'),first);});
test('invalid flags and missing files do not echo paths or arguments',t=>{const x=fixture(t);const r=x.run('preflight',['--unknown','private-value']);assert.equal(r.status,1);assert.equal(r.stderr.includes('private-value'),false);fs.unlinkSync(x.input);const missing=x.run('preflight');assert.equal(missing.status,1);assert.equal(missing.stderr.includes(x.input),false);assert.equal(fs.existsSync(x.out),false);});
