import {pinConversationCommand} from './durableConversationCommand.js';

/**
 * Trusted transaction orchestration contract for a future durable writer.
 * No production adapters, SQL mutation privileges or endpoints are exposed.
 */
export class ConversationTransactionBoundary {
  #transaction;#authorize;#commit;
  constructor({transaction,authorize,commit}={}){
    if(typeof transaction!=='function'||typeof authorize!=='function'||typeof commit!=='function')
      throw new Error('CONVERSATION_TRANSACTION_CONFIGURATION_INVALID');
    this.#transaction=transaction;this.#authorize=authorize;this.#commit=commit;
  }
  async execute({command,session}={}){
    const pinned=pinConversationCommand(command);
    if(!session||typeof session!=='object')throw new Error('CONVERSATION_TRANSACTION_DENIED');
    try{
      return await this.#transaction(async tx=>{
        if(!tx||typeof tx.query!=='function')throw new Error('CONVERSATION_TRANSACTION_DENIED');
        const permission=await this.#authorize({tx,session,command:pinned});
        if(permission!==true)throw new Error('CONVERSATION_TRANSACTION_DENIED');
        const result=await this.#commit({tx,session,command:pinned});
        if(!result||result.committed!==true||result.audited!==true)
          throw new Error('CONVERSATION_TRANSACTION_DENIED');
        return Object.freeze({committed:true,audited:true});
      });
    }catch{throw new Error('CONVERSATION_TRANSACTION_DENIED');}
  }
}
