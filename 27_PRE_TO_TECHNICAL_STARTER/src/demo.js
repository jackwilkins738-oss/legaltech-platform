import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {IdempotencyStore,AuditLog} from './domain.js';
import {MockProclaimAdapter} from './adapters.js';
import {processInbound} from './pipeline.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const matters=JSON.parse(fs.readFileSync(path.join(here,'../fixtures/matters.json'),'utf8'));
const emails=fs.readFileSync(path.join(here,'../fixtures/emails.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const idem=new IdempotencyStore(); const audit=new AuditLog(); const proclaim=new MockProclaimAdapter(matters);
for(const email of emails.slice(0,6)){
  const result=await processInbound({tenantId:'TENANT_DEMO',email,matters,proclaim,idempotency:idem,audit,confirmedMatterId:email.expected_matter_id});
  console.log(email.email_id,result.status,result.match?.reason??'');
}
console.log('audit entries',audit.entries.length);
