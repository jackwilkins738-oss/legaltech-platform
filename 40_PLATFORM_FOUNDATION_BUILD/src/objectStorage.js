import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {appError} from './errors.js';
const unavailable=()=>appError('object storage unavailable',{status:503,code:'OBJECT_STORAGE_UNAVAILABLE'});
const MAX_OBJECT_BYTES=15*1024*1024,MAX_META_BYTES=64*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const record=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function fields(value){if(!record(value))throw unavailable();const descriptors=Object.getOwnPropertyDescriptors(value);for(const key of Reflect.ownKeys(descriptors))if(typeof key!=='string'||!Object.hasOwn(descriptors[key],'value'))throw unavailable();return descriptors;}
const data=(descriptors,key,fallback)=>descriptors[key]?.value===undefined?fallback:descriptors[key].value;
function metadataCopy(value){
  let nodes=0,budget=0;const consume=n=>{budget+=n;if(budget>MAX_META_BYTES)throw unavailable();};const visit=(item,depth=0)=>{
    if(++nodes>8192||depth>8)throw unavailable();consume(2);
    if(item===null||typeof item==='boolean')return item;
    if(typeof item==='string'){consume(Buffer.byteLength(item));return item;}
    if(typeof item==='number'){if(!Number.isFinite(item))throw unavailable();return item;}
    if(Array.isArray(item)){if(Object.getPrototypeOf(item)!==Array.prototype||item.length>8192)throw unavailable();const result=[];for(let i=0;i<item.length;i++){const d=Object.getOwnPropertyDescriptor(item,String(i));if(!d||!Object.hasOwn(d,'value'))throw unavailable();result.push(visit(d.value,depth+1));}return result;}
    const descriptors=fields(item),result=Object.create(null);for(const [key,d] of Object.entries(descriptors)){consume(Buffer.byteLength(key));result[key]=visit(d.value,depth+1);}return result;
  };
  if(!record(value))throw unavailable();return visit(value);
}
const contentType=value=>typeof value==='string'&&value.trim().length>0&&value.length<=255&&!/[\x00-\x1f\x7f]/.test(value);
const identity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const unchanged=(a,b)=>identity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
export class LocalObjectStorage {
  #root;#rootStat;
  constructor(root){try{fs.mkdirSync(path.resolve(root),{recursive:true});this.#root=fs.realpathSync(path.resolve(root));this.#rootStat=fs.lstatSync(this.#root,{bigint:true});if(!this.#rootStat.isDirectory()||this.#rootStat.isSymbolicLink())throw unavailable();Object.defineProperty(this,'root',{value:this.#root,enumerable:true});}catch{throw unavailable();}}
  #tenant(tenant){if(typeof tenant!=='string'||!tenant||tenant.length>200||/[^a-zA-Z0-9_-]/.test(tenant))throw unavailable();return tenant;}
  #stat(file){try{return fs.lstatSync(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw unavailable();}}
  #rootCheck(){const stat=this.#stat(this.#root);if(!stat||!stat.isDirectory()||stat.isSymbolicLink()||!identity(stat,this.#rootStat))throw unavailable();}
  #directory(tenant,create=false){this.#rootCheck();const dir=path.join(this.#root,tenant);if(create){try{fs.mkdirSync(dir);}catch(error){if(error.code!=='EEXIST')throw unavailable();}}const stat=this.#stat(dir);if(!stat)return null;if(!stat.isDirectory()||stat.isSymbolicLink())throw unavailable();return {dir,stat};}
  #directoryCheck(context){this.#rootCheck();const stat=this.#stat(context.dir);if(!stat||!stat.isDirectory()||stat.isSymbolicLink()||!identity(stat,context.stat))throw unavailable();}
  #read(file,limit){
    const before=this.#stat(file);if(!before)return null;if(!before.isFile()||before.isSymbolicLink()||before.size>limit)throw unavailable();
    let fd;
    try{
      fd=fs.openSync(file,fs.constants.O_RDONLY|(process.platform==='win32'?0:(fs.constants.O_NOFOLLOW??0)));const opened=fs.fstatSync(fd,{bigint:true});
      if(!opened.isFile()||opened.size>limit||!unchanged(before,opened))throw unavailable();
      const buffer=Buffer.alloc(Math.min(limit+1,Number(opened.size)+1));let length=0;
      while(length<buffer.length){const n=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}
      const after=fs.fstatSync(fd,{bigint:true}),named=this.#stat(file);
      if(length>limit||length!==Number(opened.size)||!unchanged(opened,after)||!named||!named.isFile()||named.isSymbolicLink()||!unchanged(after,named))throw unavailable();
      return Buffer.from(buffer.subarray(0,length));
    }catch{throw unavailable();}finally{if(fd!==undefined){try{fs.closeSync(fd);}catch{throw unavailable();}}}
  }
  #verify(context,tenant,hash){
    const bytes=this.#read(path.join(context.dir,hash+'.bin'),MAX_OBJECT_BYTES);if(bytes===null)return null;if(digest(bytes)!==hash)throw unavailable();
    const raw=this.#read(path.join(context.dir,hash+'.json'),MAX_META_BYTES);if(raw===null)throw unavailable();
    let envelope;
    try{const text=raw.toString('utf8');if(!Buffer.from(text,'utf8').equals(raw))throw unavailable();envelope=JSON.parse(text);const d=fields(envelope);if(Object.keys(d).length!==5||data(d,'tenantId')!==tenant||data(d,'hash')!==hash||data(d,'size')!==bytes.length||!contentType(data(d,'contentType')))throw unavailable();metadataCopy(data(d,'metadata'));if(Buffer.byteLength(JSON.stringify(envelope))>MAX_META_BYTES)throw unavailable();}catch{throw unavailable();}
    this.#directoryCheck(context);return bytes;
  }
  put(input){
    try{
      const d=fields(input),tenant=this.#tenant(data(d,'tenantId')),source=data(d,'bytes'),type=data(d,'contentType','application/octet-stream');
      if((!Buffer.isBuffer(source)&&!(source instanceof Uint8Array))||source.byteLength>MAX_OBJECT_BYTES||!contentType(type))throw unavailable();
      const bytes=Buffer.from(source),hash=digest(bytes),metadata=metadataCopy(data(d,'metadata',{})),serialized=JSON.stringify({tenantId:tenant,hash,size:bytes.length,contentType:type,metadata},null,2);
      if(Buffer.byteLength(serialized)>MAX_META_BYTES)throw unavailable();
      const context=this.#directory(tenant,true),bin=path.join(context.dir,hash+'.bin'),meta=path.join(context.dir,hash+'.json'),existingBin=this.#stat(bin),existingMeta=this.#stat(meta);
      if(existingBin||existingMeta){if(!existingBin||!existingMeta||this.#verify(context,tenant,hash)===null)throw unavailable();}
      else{
        this.#directoryCheck(context);
        for(const [file,value] of [[bin,bytes],[meta,serialized]]){try{fs.writeFileSync(file,value,{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw unavailable();}}
        if(this.#verify(context,tenant,hash)===null)throw unavailable();
      }
      return {objectRef:`${tenant}/${hash}`,hash,size:bytes.length,contentType:type};
    }catch{throw unavailable();}
  }
  get(input){
    try{const d=fields(input),tenant=this.#tenant(data(d,'tenantId')),objectRef=data(d,'objectRef');if(typeof objectRef!=='string')return null;const match=/^([A-Za-z0-9_-]+)\/([a-f0-9]{64})$/.exec(objectRef);if(!match||match[0]!==objectRef||match[1]!==tenant)return null;const context=this.#directory(tenant);return context?this.#verify(context,tenant,match[2]):null;}catch{throw unavailable();}
  }
}
