import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const nodeMajor=Number(process.versions.node.split('.')[0]);
let checks={node22plus:nodeMajor>=22,noCustomerEnv:true,repoVerify:false,contractVerify:false};
const envPath=path.join(root,'30_PRODUCTION_SHAPE_SCAFFOLD/.env');
if(fs.existsSync(envPath)){
  const e=fs.readFileSync(envPath,'utf8');
  if(/prod|customer|client_secret|password/i.test(e)) checks.noCustomerEnv=false;
}
try{execFileSync(process.execPath,[path.join(here,'verify-repo.mjs')],{stdio:'ignore'});checks.repoVerify=true;}catch{}
try{execFileSync(process.execPath,[path.join(here,'verify-contracts.mjs')],{stdio:'ignore'});checks.contractVerify=true;}catch{}
const ok=Object.values(checks).every(Boolean);
console.log(JSON.stringify({ok,checks},null,2));
if(!ok)process.exit(1);
