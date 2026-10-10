import {types} from 'node:util';

export function exactLifecycleRecord(value,keys,code){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length
    ||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))throw new Error(code);
  return value;
}
export function discardLifecyclePromise(value){
  if(types.isPromise(value))Promise.prototype.then.call(value,undefined,()=>{});
}

// Reference registries are synchronous. Provider callbacks must not change registry
// state recursively; even a caught recursive attempt invalidates the outer change.
export class LifecycleTransitionGuard{
  #now;#prefix;#busy=false;#reentered=false;#lastClock=-1;#observing=false;
  constructor(now,prefix){this.#now=now;this.#prefix=prefix;}
  assertUninterrupted(){if(this.#reentered)throw new Error(`${this.#prefix}_TRANSITION_REENTERED`);}
  observeClock(){
    if(this.#observing){this.#reentered=true;throw new Error(`${this.#prefix}_CLOCK_INVALID`);}
    if(!this.#busy)this.#reentered=false;this.#observing=true;
    try{
      let at;try{at=this.#now();}catch{throw new Error(`${this.#prefix}_CLOCK_INVALID`);}
      discardLifecyclePromise(at);
      if(!Number.isSafeInteger(at)||at<0||at>8640000000000000||at<this.#lastClock)throw new Error(`${this.#prefix}_CLOCK_INVALID`);
      this.assertUninterrupted();this.#lastClock=at;return at;
    }finally{this.#observing=false;}
  }
  run(work){
    if(this.#busy){this.#reentered=true;throw new Error(`${this.#prefix}_TRANSITION_BUSY`);}
    this.#busy=true;this.#reentered=false;
    try{
      const at=this.observeClock();
      const result=work(new Date(at).toISOString());
      if(this.#reentered)throw new Error(`${this.#prefix}_TRANSITION_REENTERED`);
      return result;
    }finally{this.#busy=false;}
  }
}
