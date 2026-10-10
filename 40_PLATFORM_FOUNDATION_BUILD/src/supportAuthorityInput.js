// Current security boundary: copy identity before any provider or database await.
// Never evaluate caller accessors or retain caller-owned authorization records.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function pinSupportFields(input,required,optional=[],deny){
  try{
    if(!input||Object.getPrototypeOf(input)!==Object.prototype)throw deny();
    const pinned={};
    for(const key of [...required,...optional]){
      const descriptor=Object.getOwnPropertyDescriptor(input,key);
      if(!descriptor&&optional.includes(key))continue;
      if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw deny();
      pinned[key]=descriptor.value;
    }
    return Object.freeze(pinned);
  }catch{throw deny();}
}
export function pinSupportSession(session,deny){
  const pinned=pinSupportFields(session,['tenantId','actorId','sessionId'],[],deny);
  if(!Object.values(pinned).every(value=>typeof value==='string'&&UUID.test(value)))throw deny();
  return pinned;
}
