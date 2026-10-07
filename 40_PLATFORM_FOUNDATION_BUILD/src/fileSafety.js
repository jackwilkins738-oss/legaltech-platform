const executableMagics=[Buffer.from([0x4d,0x5a]),Buffer.from([0x7f,0x45,0x4c,0x46])];
const blockedExt=/\.(?:exe|dll|js|vbs|ps1|bat|cmd|scr|com|msi)$/i;
const MAX_BYTES=15*1024*1024;
const quarantine=reason=>({verdict:'QUARANTINE',reason});
export function inspectFile(input){
  try{
    if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return quarantine('invalid_input');
    const descriptors=Object.getOwnPropertyDescriptors(input);for(const key of Reflect.ownKeys(descriptors))if(typeof key!=='string'||!Object.hasOwn(descriptors[key],'value'))return quarantine('invalid_input');
    const filename=descriptors.filename?.value,bytes=descriptors.bytes?.value,maxBytes=descriptors.maxBytes?.value===undefined?MAX_BYTES:descriptors.maxBytes.value;
    if((!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))||!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>MAX_BYTES)return quarantine('invalid_input');
    if(bytes.byteLength>maxBytes)return quarantine('size_limit');
    if(typeof filename!=='string'||!filename.trim()||filename.length>255||/[\x00-\x1f\x7f\\/:]/.test(filename))return quarantine('unsafe_filename');
    const canonical=filename.replace(/[ .]+$/g,'');if(!canonical)return quarantine('unsafe_filename');
    if(blockedExt.test(canonical))return quarantine('blocked_extension');
    const prefix=Buffer.from(bytes.subarray(0,4));if(executableMagics.some(m=>prefix.subarray(0,m.length).equals(m)))return quarantine('executable_content');
    return {verdict:'SAFE_FOR_PARSER',reason:'basic_checks_passed'};
  }catch{return quarantine('invalid_input');}
}
