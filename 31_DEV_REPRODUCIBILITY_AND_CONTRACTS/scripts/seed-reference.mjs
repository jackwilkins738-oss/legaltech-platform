import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const base=path.join(os.tmpdir(),'legaltech-reference-dev');
fs.mkdirSync(base,{recursive:true});
const seed={tenants:[{id:'TENANT-A'},{id:'TENANT-B'}],matters:[{id:'MAT-A-001',tenant_id:'TENANT-A',display_reference:'CLM-70001'},{id:'MAT-B-001',tenant_id:'TENANT-B',display_reference:'CLM-80001'}],exceptions:[]};
fs.writeFileSync(path.join(base,'seed.json'),JSON.stringify(seed,null,2));
console.log(JSON.stringify({ok:true,path:path.join(base,'seed.json'),matters:seed.matters.length},null,2));
