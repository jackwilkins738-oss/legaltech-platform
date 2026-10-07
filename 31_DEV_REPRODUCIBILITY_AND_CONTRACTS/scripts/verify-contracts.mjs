import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const api=fs.readFileSync(path.join(root,'22_IMPLEMENTATION_FOUNDATION/OPENAPI_V1.yaml'),'utf8');
const requiredPaths=['/health:','/matters/{matterId}:','/inbound-events:','/exceptions:','/exceptions/{exceptionId}/resolve:','/integrations/proclaim/writebacks:'];
const failures=requiredPaths.filter(p=>!api.includes(p)).map(p=>`missing-openapi-path:${p}`);
const schemas=['event_envelope.schema.json','matter_match_proposed.schema.json','exception.schema.json'];
for(const s of schemas){
  const p=path.join(root,'22_IMPLEMENTATION_FOUNDATION/schemas',s);
  if(!fs.existsSync(p)) failures.push(`missing-schema:${s}`);
  else JSON.parse(fs.readFileSync(p,'utf8'));
}
console.log(JSON.stringify({ok:!failures.length,failures,openapiPaths:requiredPaths.length,schemas:schemas.length},null,2));
if(failures.length) process.exit(1);
