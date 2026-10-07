import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class FileObjectStorage {
  constructor(root) { this.root=path.resolve(root); fs.mkdirSync(this.root,{recursive:true}); }
  safeTenant(tenantId) { if(!/^[a-zA-Z0-9_-]+$/.test(tenantId)) throw new Error('invalid tenant'); return tenantId; }
  put({tenantId,bytes,contentType='application/octet-stream'}) {
    const tenant=this.safeTenant(tenantId); const hash=crypto.createHash('sha256').update(bytes).digest('hex');
    const dir=path.join(this.root,tenant); fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,hash+'.bin'); if(!fs.existsSync(file)) fs.writeFileSync(file,bytes,{mode:0o600});
    fs.writeFileSync(path.join(dir,hash+'.json'),JSON.stringify({tenantId:tenant,hash,contentType,size:bytes.length},null,2),{mode:0o600});
    return {objectRef:`${tenant}/${hash}`,hash,size:bytes.length,contentType};
  }
  get({tenantId,objectRef}) {
    const tenant=this.safeTenant(tenantId); const [refTenant,hash]=String(objectRef).split('/');
    if(refTenant!==tenant || !/^[a-f0-9]{64}$/.test(hash||'')) return null;
    const file=path.join(this.root,tenant,hash+'.bin'); return fs.existsSync(file)?fs.readFileSync(file):null;
  }
}
