import fs from 'node:fs';

const securitySql=fs.readFileSync(new URL('../db/verification/runtime_security.sql',import.meta.url),'utf8');
const identifier=/^[a-z_][a-z0-9_]{0,62}$/;
// pool must be the same restricted-runtime connection pool used by the API.
// This checks catalog posture, not policy behaviour or migration checksums.
export function createPostgresRuntimeProbe({pool,expectedRole,schema='public'}={}) {
  if(typeof pool?.connect!=='function'||!identifier.test(expectedRole??'')||!identifier.test(schema)) throw new Error('POSTGRES_RUNTIME_PROBE_CONFIGURATION_INVALID');
  return async function postgresRuntimeProbe({signal}={}) {
    let client,released=false,failed=false;
    const release=(destroy=false)=>{
      if(client&&!released) { released=true; client.release(destroy?new Error('RUNTIME_PROBE_CONNECTION_DISCARDED'):undefined); }
    };
    const aborted=()=>release(true);
    try {
      if(signal?.aborted) return {ok:false,code:'DATABASE_RUNTIME_UNVERIFIED'};
      client=await pool.connect();
      if(signal?.aborted) { failed=true; return {ok:false,code:'DATABASE_RUNTIME_UNVERIFIED'}; }
      signal?.addEventListener('abort',aborted,{once:true});
      const query=async(...args)=>{
        if(signal?.aborted) throw new Error('RUNTIME_PROBE_ABORTED');
        const result=await client.query(...args);
        if(signal?.aborted) throw new Error('RUNTIME_PROBE_ABORTED');
        return result;
      };
      await query('BEGIN READ ONLY');
      await query("SET LOCAL statement_timeout='5s'");
      await query("SET LOCAL lock_timeout='1s'");
      await query('SET LOCAL row_security=on');
      await query('SET LOCAL search_path=pg_catalog');
      await query("SELECT set_config('verification.expected_role',$1,true),set_config('verification.schema',$2,true)",[expectedRole,schema]);
      await query(securitySql);
      await query('ROLLBACK');
      return signal?.aborted?{ok:false,code:'DATABASE_RUNTIME_UNVERIFIED'}:{ok:true,code:'DATABASE_RUNTIME_VERIFIED'};
    } catch {
      failed=true;
      return {ok:false,code:'DATABASE_RUNTIME_UNVERIFIED'};
    } finally {
      signal?.removeEventListener('abort',aborted);
      // On any error destroy the connection; never reuse an open/aborted transaction.
      release(failed||signal?.aborted);
    }
  };
}
