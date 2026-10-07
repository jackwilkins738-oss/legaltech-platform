import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
export class LocalObjectStorage {
  constructor(root){this.root=path.resolve(root);fs.mkdirSync(this.root,{recursive:true});}
  #tenant(t){if(!/^[a-zA-Z0-9_-]+$/.test(t))throw new Error('invalid tenant');return t;}
  put({tenantId,bytes,contentType='application/octet-stream',metadata={}}){
    const tenant=this.#tenant(tenantId), buf=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes), hash=crypto.createHash('sha256').update(buf).digest('hex');
    const dir=path.join(this.root,tenant);fs.mkdirSync(dir,{recursive:true});const bin=path.join(dir,`${hash}.bin`), meta=path.join(dir,`${hash}.json`);
    if(!fs.existsSync(bin))fs.writeFileSync(bin,buf,{mode:0o600});
    if(!fs.existsSync(meta))fs.writeFileSync(meta,JSON.stringify({tenantId:tenant,hash,size:buf.length,contentType,metadata},null,2),{mode:0o600});
    return {objectRef:`${tenant}/${hash}`,hash,size:buf.length,contentType};
  }
  get({tenantId,objectRef}){const tenant=this.#tenant(tenantId);const [rt,hash]=String(objectRef).split('/');if(rt!==tenant||!/^[a-f0-9]{64}$/.test(hash||''))return null;const p=path.join(this.root,tenant,`${hash}.bin`);return fs.existsSync(p)?fs.readFileSync(p):null;}
}
