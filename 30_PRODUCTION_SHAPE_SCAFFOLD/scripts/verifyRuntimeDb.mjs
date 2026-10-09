import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const args=process.argv.slice(2),options={schema:'public',role:null,isolation:false};
try {
  while(args.length) {
    const flag=args.shift();
    if(flag==='--isolation'&&!options.isolation) options.isolation=true;
    else if(flag==='--runtime-role'&&options.role===null) options.role=args.shift();
    else if(flag==='--schema'&&options.schema==='public') options.schema=args.shift();
    else throw new Error('INVALID_ARGUMENTS');
  }
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(options.role??'')||!/^[a-z_][a-z0-9_]{0,62}$/.test(options.schema??'')) throw new Error('INVALID_IDENTIFIERS');
} catch {
  console.error('Usage: npm run check:runtime-db -- --runtime-role legaltech_runtime [--schema public] [--isolation]');
  process.exit(2);
}
const file=fileURLToPath(new URL(`../db/verification/${options.isolation?'verify_rls_isolation.sql':'verify_runtime.sql'}`,import.meta.url));
// psql uses PGSERVICE / normal PG* environment and its password file. No DSN in argv.
const result=spawnSync('psql',['-X','--no-password',`--set=runtime_role=${options.role}`,`--set=app_schema=${options.schema}`,'--file',path.resolve(file)],{stdio:'inherit',shell:false});
if(result.error) { console.error('PSQL_EXECUTION_UNAVAILABLE');process.exit(1); }
process.exit(result.status??1);
