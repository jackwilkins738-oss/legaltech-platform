// Synthetic PostgreSQL integration worker. No production entry point or admin role.
import {Pool} from 'pg';
import {createTenantScopedPostgresSupportGrantLookup} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresSupportGrantLookup.js';
if(process.env.LEGALTECH_RUN_POSTGRES_TESTS!=='true'||process.env.PGDATABASE!=='legaltech_security_ci'||process.env.PGUSER!=='legaltech_support_reader_ci')throw Error('SYNTHETIC_READER_ONLY');
const pool=new Pool({max:1,connectionTimeoutMillis:2000,idleTimeoutMillis:500});
pool.on('error',()=>{});
const lookup=createTenantScopedPostgresSupportGrantLookup({pool,expectedRole:process.env.PGUSER});
process.on('message',async message=>{
  if(message.operation==='close'){await pool.end();process.disconnect();return;}
  try{await lookup(message.input);process.send({id:message.id,allowed:true,pid:process.pid});}
  catch{process.send({id:message.id,allowed:false,pid:process.pid});}
});
process.send({ready:true,pid:process.pid});
