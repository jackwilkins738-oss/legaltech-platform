import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const base=path.join(os.tmpdir(),'legaltech-reference-dev');
fs.rmSync(base,{recursive:true,force:true});
fs.mkdirSync(base,{recursive:true});
console.log(JSON.stringify({ok:true,reset:base},null,2));
