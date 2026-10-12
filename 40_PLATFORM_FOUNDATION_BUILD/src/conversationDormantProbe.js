import {PostgresTenantTransactions} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';
import {assertConversationStorageDormant,conversationStorageProofSql} from './conversationStorageProof.js';

const tables=Object.freeze([
  'matter_conversation_threads','matter_conversation_participants',
  'matter_conversation_messages','matter_conversation_audit'
]);
const unavailable=()=>new Error('CONVERSATION_ADMISSION_DENIED');

/** Transaction callback is trusted server code bound to a restricted PostgreSQL login. */
export class ConversationDormantProbe {
  #read;
  constructor({read}={}){
    if(typeof read!=='function')throw new Error('CONVERSATION_PROBE_CONFIGURATION_INVALID');
    this.#read=read;
  }
  async verify(){
    try{
      const result=await this.#read(async tx=>{
        if(typeof tx?.query!=='function')throw unavailable();
        const result=await tx.query(conversationStorageProofSql,[tables]);
        return assertConversationStorageDormant(result.rows);
      });
      if(result?.status!=='DORMANT'||result.tables!==4)throw unavailable();
      return Object.freeze({status:'DORMANT',tables:4});
    }catch{throw unavailable();}
  }
}

/** Only a restricted database login can execute this trusted read-only probe. */
export function createTenantScopedConversationDormantProbe({pool,expectedRole,tenantId,actorId,timeoutMs=3000}={}){
  if(typeof expectedRole!=='string'||!/^legaltech_[a-z0-9_]{1,48}$/.test(expectedRole)||
    typeof tenantId!=='string'||!/^[0-9a-f-]{36}$/i.test(tenantId)||
    typeof actorId!=='string'||!/^[0-9a-f-]{36}$/i.test(actorId))
    throw new Error('CONVERSATION_PROBE_CONFIGURATION_INVALID');
  const transaction=new PostgresTenantTransactions({pool,expectedRole,timeoutMs});
  return new ConversationDormantProbe({read:work=>transaction.run({tenantId,actorId,readOnly:true},work)});
}
