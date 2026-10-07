import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {appError} from './errors.js';
const unavailable=()=>appError('object storage unavailable',{status:503,code:'OBJECT_STORAGE_UNAVAILABLE'});
const MAX_OBJECT_BYTES=15*1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export class LocalObjectStorage {
  constructor(root) {
    fs.mkdirSync(path.resolve(root),{recursive:true});
    // The configured root can deliberately be a link; tenant/object paths cannot.
    this.root=fs.realpathSync(path.resolve(root));
  }
  #tenant(tenant) {
    if(typeof tenant!=='string'||!tenant||tenant.length>200||/[^a-zA-Z0-9_-]/.test(tenant)) throw unavailable();
    return tenant;
  }
  #stat(file) {
    try {return fs.lstatSync(file);}
    catch(error) {if(error.code==='ENOENT')return null;throw unavailable();}
  }
  #directory(tenant,create=false) {
    const dir=path.join(this.root,tenant);
    if(create) {try{fs.mkdirSync(dir);}catch(error){if(error.code!=='EEXIST')throw unavailable();}}
    const stat=this.#stat(dir);
    if(!stat)return null;
    if(!stat.isDirectory()||stat.isSymbolicLink())throw unavailable();
    return dir;
  }
  #readVerified(file,hash) {
    const stat=this.#stat(file);
    if(!stat)return null;
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_OBJECT_BYTES)throw unavailable();
    let bytes;
    try {bytes=fs.readFileSync(file);}catch {throw unavailable();}
    if(digest(bytes)!==hash)throw unavailable();
    return bytes;
  }
  put({tenantId,bytes,contentType='application/octet-stream',metadata={}}) {
    const tenant=this.#tenant(tenantId),buf=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    if(buf.length>MAX_OBJECT_BYTES)throw unavailable();
    const hash=digest(buf);
    const metadataBytes=JSON.stringify({tenantId:tenant,hash,size:buf.length,contentType,metadata},null,2);
    const dir=this.#directory(tenant,true),bin=path.join(dir,`${hash}.bin`),meta=path.join(dir,`${hash}.json`);
    if(this.#readVerified(bin,hash)===null) {
      // Exclusive creation never overwrites a pre-existing object or follows a link.
      try {fs.writeFileSync(bin,buf,{mode:0o600,flag:'wx'});}
      catch(error) {if(error.code!=='EEXIST')throw unavailable();}
      if(this.#readVerified(bin,hash)===null)throw unavailable();
    }
    const existingMeta=this.#stat(meta);
    if(existingMeta&&(!existingMeta.isFile()||existingMeta.isSymbolicLink()))throw unavailable();
    if(!existingMeta) {
      try {fs.writeFileSync(meta,metadataBytes,{mode:0o600,flag:'wx'});}
      catch(error) {
        if(error.code!=='EEXIST')throw unavailable();
        const raced=this.#stat(meta);
        if(!raced||!raced.isFile()||raced.isSymbolicLink())throw unavailable();
      }
    }
    return {objectRef:`${tenant}/${hash}`,hash,size:buf.length,contentType};
  }
  get({tenantId,objectRef}) {
    const tenant=this.#tenant(tenantId);
    if(typeof objectRef!=='string')return null;
    const match=/^([A-Za-z0-9_-]+)\/([a-f0-9]{64})$/.exec(objectRef);
    if(!match||match[0]!==objectRef||match[1]!==tenant)return null;
    const dir=this.#directory(tenant);
    return dir?this.#readVerified(path.join(dir,`${match[2]}.bin`),match[2]):null;
  }
}
