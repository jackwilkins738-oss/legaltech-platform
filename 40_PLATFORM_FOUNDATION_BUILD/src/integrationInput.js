import {appError} from './errors.js';
const invalid=()=>appError('invalid integration request',{code:'INVALID_REQUEST'});
export const integrationRecord=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export function integrationFields(value){if(!integrationRecord(value))throw invalid();const descriptors=Object.getOwnPropertyDescriptors(value);for(const key of Reflect.ownKeys(descriptors))if(typeof key!=='string'||!Object.hasOwn(descriptors[key],'value'))throw invalid();return descriptors;}
export function integrationOptions(value,defaults){const fields=integrationFields(value);return Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,fields[key]?.value===undefined?fallback:fields[key].value]));}
export function integrationJson(value){
  let nodes=0,budget=0;const ancestors=new Set();const consume=n=>{budget+=n;if(budget>256*1024)throw invalid();};
  function visit(item,depth=0){
    if(++nodes>5000||depth>10)throw invalid();consume(2);
    if(item===null||typeof item==='boolean')return item;
    if(typeof item==='string'){consume(Buffer.byteLength(item));return item;}
    if(typeof item==='number'&&Number.isFinite(item))return item;
    if(typeof item!=='object'||ancestors.has(item))throw invalid();ancestors.add(item);let copied;
    if(Array.isArray(item)){
      if(Object.getPrototypeOf(item)!==Array.prototype||item.length>1000)throw invalid();
      const keys=Reflect.ownKeys(item);if(keys.length!==item.length+1||keys.some(key=>typeof key!=='string'||(key!=='length'&&!/^(0|[1-9][0-9]*)$/.test(key))))throw invalid();
      copied=[];for(let i=0;i<item.length;i++){const d=Object.getOwnPropertyDescriptor(item,String(i));if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw invalid();copied.push(visit(d.value,depth+1));}
    }else{const fields=integrationFields(item);copied=Object.create(null);for(const [key,d] of Object.entries(fields)){if(!d.enumerable)throw invalid();consume(Buffer.byteLength(key));copied[key]=visit(d.value,depth+1);}}
    ancestors.delete(item);return copied;
  }
  try{const copied=visit(value);if(Buffer.byteLength(JSON.stringify(copied))>256*1024)throw invalid();return copied;}catch{throw invalid();}
}
