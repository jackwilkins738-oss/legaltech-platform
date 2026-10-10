import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateConnectionPlan} from '../src/deploymentCapacity.js';

export function checkCapacityFile(path){
  if(typeof path!=='string'||!path)throw new Error('DEPLOYMENT_CAPACITY_INPUT_INVALID');
  const descriptor=openSync(path,constants.O_RDONLY|(constants.O_NONBLOCK??0));
  try{
    const info=fstatSync(descriptor);
    if(!info.isFile()||info.size>32768)throw new Error('DEPLOYMENT_CAPACITY_INPUT_INVALID');
    const bytes=Buffer.alloc(32769);let size=0;
    while(size<bytes.length){const count=readSync(descriptor,bytes,size,bytes.length-size,null);if(count===0)break;size+=count;}
    if(size>32768)throw new Error('DEPLOYMENT_CAPACITY_INPUT_INVALID');
    return validateConnectionPlan(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))));
  }finally{closeSync(descriptor);}
}
export function main(args,{write=line=>process.stdout.write(line+'\n')}={}){
  try{
    if(args.length!==1)throw new Error('DEPLOYMENT_CAPACITY_INPUT_INVALID');
    const plan=checkCapacityFile(args[0]);
    write(JSON.stringify({status:'VALID_PLAN',poolCount:plan.pools.length,perReplica:plan.perReplica,fleetConnections:plan.fleetConnections,headroom:plan.headroom}));return 0;
  }catch{write(JSON.stringify({status:'INVALID_PLAN'}));return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main(process.argv.slice(2));
