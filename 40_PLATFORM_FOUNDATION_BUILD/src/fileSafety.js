const executableMagics=[Buffer.from([0x4d,0x5a]),Buffer.from([0x7f,0x45,0x4c,0x46])];
const blockedExt=/\.(?:exe|dll|js|vbs|ps1|bat|cmd|scr|com|msi)$/i;
const MAX_BYTES=15*1024*1024;
export const BASIC_INGEST_ACCEPTED='BASIC_INGEST_ACCEPTED';
const legacyAccepted='SAFE_FOR_PARSER';
const quarantine=reason=>({verdict:'QUARANTINE',reason});
export const basicIngestAccepted=verdict=>verdict===BASIC_INGEST_ACCEPTED||verdict===legacyAccepted;
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
    // This is only a cheap ingestion gate. It is deliberately NOT a claim that the file
    // is malware-free or safe to parse in a privileged process.
    return {verdict:BASIC_INGEST_ACCEPTED,reason:'basic_checks_passed',productionReady:false};
  }catch{return quarantine('invalid_input');}
}

export function assertProductionFileEvidence(value){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error('PRODUCTION_FILE_EVIDENCE_REQUIRED');
  const {basicVerdict,malwareScan,parserIsolation,scannedAt,scannerRef}=value;
  if(!basicIngestAccepted(basicVerdict)||malwareScan!=='CLEAN'||parserIsolation!=='ISOLATED'||typeof scannerRef!=='string'||!/^[A-Za-z0-9._:/-]{3,200}$/.test(scannerRef)||!Number.isFinite(Date.parse(scannedAt)))throw new Error('PRODUCTION_FILE_EVIDENCE_REQUIRED');
  return true;
}
