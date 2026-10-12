import {assertConversationStorageDormant,conversationStorageProofSql} from './conversationStorageProof.js';

const names=Object.freeze(['matter_conversation_threads','matter_conversation_participants','matter_conversation_messages','matter_conversation_audit']);
const denied=()=>new Error('CONVERSATION_ACTIVATION_DENIED');

/**
 * V210 security gate: never treat an optional readiness probe as permission to
 * serve production messaging. The dormant state is the only accepted state.
 */
export class ConversationActivationGuard {
  #transaction;#active;
  constructor({transaction,active=false}={}){
    if(typeof transaction!=='function'||active!==false)throw new Error('CONVERSATION_GUARD_CONFIGURATION_INVALID');
    this.#transaction=transaction;this.#active=false;
  }
  async assertDisabled(){
    if(this.#active!==false)throw denied();
    try{
      const proof=await this.#transaction(async tx=>{
        if(typeof tx?.query!=='function')throw denied();
        const rows=(await tx.query(conversationStorageProofSql,[names]))?.rows;
        return assertConversationStorageDormant(rows);
      });
      if(proof?.status!=='DORMANT'||proof.tables!==4)throw denied();
      return Object.freeze({productionMessagingEnabled:false,storageStatus:'DORMANT'});
    }catch{throw denied();}
  }
  async createThread(){throw denied();}
  async sendMessage(){throw denied();}
  async changeParticipants(){throw denied();}
}
