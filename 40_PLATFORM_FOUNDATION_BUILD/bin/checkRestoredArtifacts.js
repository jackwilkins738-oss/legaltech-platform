import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';
import {RestoredArtifactVerifier,validateRestoreInventory,exactRecord} from '../src/restoredArtifacts.js';

function readRegular(file,maximum,expectedSize=null){
  const before=fs.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>maximum||expectedSize!==null&&before.size!==expectedSize)throw new Error('INVALID_ARTIFACT');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
  let buffer;
  try{
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw new Error('INVALID_ARTIFACT');
    buffer=Buffer.alloc(opened.size+1);let offset=0,n;
    while(offset<buffer.length&&(n=fs.readSync(fd,buffer,offset,buffer.length-offset,null))!==0)offset+=n;
    if(offset!==opened.size)throw new Error('INVALID_ARTIFACT');
    return buffer.subarray(0,offset);
  }catch(error){buffer?.fill(0);throw error;}finally{fs.closeSync(fd);}
}

// Local operator evidence only. JSON output cannot be used as an in-process recovery proof.
export function checkRestoredArtifactDirectory(planFile,directory){
  const planBytes=readRegular(planFile,512*1024);let plan;
  try{plan=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(planBytes));}finally{planBytes.fill(0);}
  exactRecord(plan,['inventory','context']);const inventory=validateRestoreInventory(plan.inventory);
  const verifier=new RestoredArtifactVerifier({inventory,context:plan.context});
  const directoryStat=fs.lstatSync(directory);
  if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())throw new Error('INVALID_DIRECTORY');
  const actual=fs.readdirSync(directory).sort(),expected=inventory.artifacts.map(a=>`${a.artifactId}.bin`).sort();
  if(actual.length!==expected.length||actual.some((name,i)=>name!==expected[i]))throw new Error('INVALID_DIRECTORY');
  for(const artifact of inventory.artifacts){
    const bytes=readRegular(path.join(directory,`${artifact.artifactId}.bin`),64*1024*1024,artifact.size);
    try{verifier.checkArtifact({artifactId:artifact.artifactId,bytes});}finally{bytes.fill(0);}
  }
  const evidence=verifier.complete();
  return Object.freeze({status:'VERIFIED_ARTIFACTS',contentHash:evidence.contentHash,artifactCount:evidence.artifactCount,objectCount:evidence.objectCount,totalBytes:evidence.totalBytes});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==4)throw new Error('INVALID_ARGUMENTS');process.stdout.write(`${JSON.stringify(checkRestoredArtifactDirectory(process.argv[2],process.argv[3]))}\n`);}
  catch{process.stderr.write('RESTORED_ARTIFACT_CHECK_FAILED\n');process.exitCode=1;}
}
