import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIGRATION_FILE=/^[0-9]{3}_[a-z0-9_]{1,80}\.sql$/;
const HASH=/^[a-f0-9]{64}$/;
const REVIEW_REF=/^[A-Za-z0-9._:/-]{3,128}$/;
const MAX_SQL_BYTES=512*1024;
const MAX_MANIFEST_BYTES=128*1024;
const DESTRUCTIVE_PATTERNS=[
  /\bDROP\s+(?:TABLE|SCHEMA|DATABASE|TYPE)\b/i,
  /\bALTER\s+TABLE\b[\s\S]{0,300}\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];
function fail(code){ const error=new Error(code); error.code=code; throw error; }
function sha256(bytes){ return crypto.createHash('sha256').update(bytes).digest('hex'); }
function ownObject(value){ return value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype; }
function validateManifestObject(manifest){
  if(!ownObject(manifest)||manifest.version!==1||!Array.isArray(manifest.migrations)||manifest.migrations.length<1||manifest.migrations.length>999) fail('INVALID_MIGRATION_MANIFEST');
  if(Object.keys(manifest).some(k=>!['version','migrations'].includes(k))) fail('INVALID_MIGRATION_MANIFEST');
  const seen=new Set(); let expected=1;
  const rows=manifest.migrations.map(row=>{
    if(!ownObject(row)||Object.keys(row).some(k=>!['file','sha256','destructive','destructiveReviewRef'].includes(k))) fail('INVALID_MIGRATION_MANIFEST_ENTRY');
    if(!MIGRATION_FILE.test(row.file??'')||!HASH.test(row.sha256??'')||typeof row.destructive!=='boolean') fail('INVALID_MIGRATION_MANIFEST_ENTRY');
    if(seen.has(row.file)) fail('DUPLICATE_MIGRATION_FILE'); seen.add(row.file);
    const number=Number(row.file.slice(0,3)); if(number!==expected) fail('MIGRATION_SEQUENCE_GAP'); expected++;
    if(row.destructive){ if(!REVIEW_REF.test(row.destructiveReviewRef??'')) fail('DESTRUCTIVE_MIGRATION_REVIEW_REQUIRED'); }
    else if(row.destructiveReviewRef!==undefined) fail('UNEXPECTED_DESTRUCTIVE_REVIEW_REF');
    return Object.freeze({...row});
  });
  return Object.freeze({version:1,migrations:Object.freeze(rows)});
}
export function loadMigrationManifest(manifestPath){
  const stat=fs.lstatSync(manifestPath); if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>MAX_MANIFEST_BYTES) fail('INVALID_MIGRATION_MANIFEST_FILE');
  let value; try{ value=JSON.parse(fs.readFileSync(manifestPath,'utf8')); }catch{ fail('INVALID_MIGRATION_MANIFEST'); }
  return validateManifestObject(value);
}
export function detectDestructiveSql(sql){
  if(typeof sql!=='string') fail('INVALID_MIGRATION_SQL');
  return DESTRUCTIVE_PATTERNS.some(pattern=>pattern.test(sql));
}
export function verifyMigrationDirectory({directory,manifest}){
  manifest=validateManifestObject(manifest);
  const base=fs.realpathSync(directory);
  const actual=fs.readdirSync(base,{withFileTypes:true}).filter(entry=>entry.name.endsWith('.sql'));
  for(const entry of actual) if(!entry.isFile()||entry.isSymbolicLink?.()||!MIGRATION_FILE.test(entry.name)) fail('UNSAFE_MIGRATION_FILE');
  const actualNames=actual.map(x=>x.name).sort(); const expectedNames=manifest.migrations.map(x=>x.file);
  if(JSON.stringify(actualNames)!==JSON.stringify(expectedNames)) fail('MIGRATION_SET_DRIFT');
  for(const row of manifest.migrations){
    const candidate=path.join(base,row.file); const resolved=fs.realpathSync(candidate);
    if(path.dirname(resolved)!==base) fail('MIGRATION_PATH_ESCAPE');
    const stat=fs.lstatSync(candidate); if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>MAX_SQL_BYTES) fail('UNSAFE_MIGRATION_FILE');
    const bytes=fs.readFileSync(candidate); if(sha256(bytes)!==row.sha256) fail('MIGRATION_CHECKSUM_DRIFT');
    const destructive=detectDestructiveSql(bytes.toString('utf8'));
    if(destructive&&!row.destructive) fail('UNREVIEWED_DESTRUCTIVE_MIGRATION');
    if(!destructive&&row.destructive) fail('DESTRUCTIVE_REVIEW_FLAG_DRIFT');
  }
  return Object.freeze({status:'VERIFIED',count:manifest.migrations.length,latest:manifest.migrations.at(-1).file});
}
export function verifyAppliedMigrations({manifest,applied}){
  manifest=validateManifestObject(manifest);
  if(!Array.isArray(applied)||applied.length>manifest.migrations.length) fail('INVALID_APPLIED_MIGRATIONS');
  const seen=new Set();
  for(let i=0;i<applied.length;i++){
    const row=applied[i]; if(!ownObject(row)||Object.keys(row).some(k=>!['file','sha256'].includes(k))||!MIGRATION_FILE.test(row.file??'')||!HASH.test(row.sha256??'')) fail('INVALID_APPLIED_MIGRATION');
    if(seen.has(row.file)) fail('DUPLICATE_APPLIED_MIGRATION'); seen.add(row.file);
    const expected=manifest.migrations[i];
    if(row.file!==expected.file) fail('APPLIED_MIGRATION_ORDER_DRIFT');
    if(row.sha256!==expected.sha256) fail('APPLIED_MIGRATION_CHECKSUM_DRIFT');
  }
  const pending=manifest.migrations.slice(applied.length).map(row=>row.file);
  return Object.freeze({status:pending.length?'PENDING':'CURRENT',appliedCount:applied.length,pending:Object.freeze(pending),latestRequired:manifest.migrations.at(-1).file});
}
export function createMigrationReadinessProbe({manifest,getApplied}){
  manifest=validateManifestObject(manifest); if(typeof getApplied!=='function') fail('INVALID_APPLIED_MIGRATION_PROVIDER');
  return async function migrationReadinessProbe(){
    try{
      const state=verifyAppliedMigrations({manifest,applied:await getApplied()});
      return state.status==='CURRENT'?{ok:true,code:'SCHEMA_CURRENT'}:{ok:false,code:'SCHEMA_MIGRATIONS_PENDING'};
    }catch{return {ok:false,code:'SCHEMA_MIGRATION_DRIFT'};}
  };
}
