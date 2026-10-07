import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(here,'../config/dev-manifest.json'),'utf8'));
let failures=[];
for (const rel of manifest.required) {
  if (!fs.existsSync(path.join(root,rel))) failures.push(`missing:${rel}`);
}
const tasks=JSON.parse(fs.readFileSync(path.join(root,'22_IMPLEMENTATION_FOUNDATION/FIRST_50_TASKS.json'),'utf8'));
for (const id of manifest.blockedEvidenceTasks) {
  const task=tasks.find(t=>t.id===id);
  if (!task || task.blocked_by_evidence!==true) failures.push(`evidence-gate:${id}`);
}
const status={ok:failures.length===0, failures, requiredCount:manifest.required.length, blockedEvidenceTasks:manifest.blockedEvidenceTasks.length};
console.log(JSON.stringify(status,null,2));
if(failures.length) process.exit(1);
