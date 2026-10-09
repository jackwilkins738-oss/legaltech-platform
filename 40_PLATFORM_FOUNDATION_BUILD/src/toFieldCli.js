import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {PlatformStore} from './store.js';
import {TOStudy} from './toStudy.js';
import {TOFieldIntake,toFieldTemplate} from './toFieldIntake.js';

// Local evidence tooling only: no network, customer runtime or persistent database.
const MAX_BYTES=2_000_000;
const fail=code=>{throw new Error(code);};
const errorCode=e=>/^[A-Z0-9_]{3,100}$/.test(e?.message??'')?e.message:'TO_CLI_FAILED';
function readBounded(file){
  const fd=fs.openSync(file,'r');
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>MAX_BYTES)fail('TO_CLI_INPUT_SIZE_INVALID');
    const data=Buffer.alloc(MAX_BYTES+1);let length=0;
    while(length<data.length){const n=fs.readSync(fd,data,length,data.length-length,null);if(!n)break;length+=n;}
    if(length>MAX_BYTES)fail('TO_CLI_INPUT_SIZE_INVALID');
    try{return new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,length));}
    catch{fail('TO_CLI_ENCODING_INVALID');}
  }finally{fs.closeSync(fd);}
}
function options(argv){
  const [command,...rest]=argv;
  if(!['template','preflight','report'].includes(command))fail('TO_CLI_USAGE_INVALID');
  const allowed=command==='template'?['--out']:command==='preflight'?['--csv','--out']:['--csv','--out','--working-days'];
  const args={command};
  for(let i=0;i<rest.length;i+=2){const key=rest[i],value=rest[i+1];if(!allowed.includes(key)||!value||value.startsWith('--')||Object.hasOwn(args,key))fail('TO_CLI_USAGE_INVALID');args[key]=value;}
  if(!args['--out']||(command!=='template'&&!args['--csv']))fail('TO_CLI_USAGE_INVALID');
  if(command==='report'){
    const days=args['--working-days'];
    if(!days||!/^\d+$/.test(days)||Number(days)<1||Number(days)>366)fail('TO_CLI_WORKING_DAYS_REQUIRED');
    args.workingDays=Number(days);
  }
  return args;
}
export function runTOFieldCli(argv,{stdout=process.stdout,stderr=process.stderr}={}){
  let store;
  try{
    const args=options(argv);let output,status=0;
    if(args.command==='template')output=toFieldTemplate();
    else{
      const csv=readBounded(args['--csv']);
      store=new PlatformStore(':memory:');
      const study=new TOStudy({store});
      const intake=new TOFieldIntake({study});
      const context={tenantId:'local-to',studyId:'preflight'};
      const pre=intake.preflight({...context,csv});
      const summary={schemaVersion:1,rows:pre.rows,validRows:pre.valid.length,rejectedRows:pre.issues.length,issues:pre.issues};
      if(args.command==='preflight'){output=JSON.stringify(summary,null,2)+'\n';status=pre.issues.length?2:0;}
      else{
        if(!pre.rows)fail('TO_CLI_EVIDENCE_EMPTY');
        if(pre.issues.length){stderr.write(JSON.stringify(summary)+'\n');return 2;}
        const created=study.createStudy({tenantId:context.tenantId,studyKey:'LOCAL_REPORT',actorId:'local-observer',traceId:'local-report',idempotencyKey:'local-study'});
        context.studyId=created.id;
        const imported=intake.importCsv({...context,csv,actorId:'local-observer',traceId:'local-report',batchKey:'LOCAL_FILE'});
        if(imported.rejected)fail('TO_CLI_IMPORT_FAILED');
        const report=intake.report({...context,workingDays:args.workingDays});
        // Ephemeral study IDs are omitted so identical input produces identical output.
        const {studyId,analysis,...aggregate}=report;void studyId;
        const {studyId:analysisStudyId,...analysisTotals}=analysis;void analysisStudyId;
        output=JSON.stringify({schemaVersion:1,inputSha256:createHash('sha256').update(csv).digest('hex'),inputSummary:summary,workingDays:args.workingDays,limitations:[
          'Local analysis of one cleaned CSV; no persistent evidence import.',
          'Validation does not certify anonymisation; review notes and codes before use.',
          'Waiting time is elapsed delay, not staff labour or recoverable savings.',
          'Targeted samples do not establish workflow prevalence.',
          'Annual exposure is a baseline estimate, not a savings or ROI claim.',
          'Product decisions require the existing evidence gate.'
        ],...aggregate,analysis:analysisTotals},null,2)+'\n';
      }
    }
    fs.writeFileSync(args['--out'],output,{encoding:'utf8',flag:'wx',mode:0o600});
    stdout.write(status?'TO_CLI_VALIDATION_ISSUES\n':'TO_CLI_COMPLETE\n');return status;
  }catch(e){stderr.write(errorCode(e)+'\n');return 1;}
  finally{store?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=runTOFieldCli(process.argv.slice(2));
