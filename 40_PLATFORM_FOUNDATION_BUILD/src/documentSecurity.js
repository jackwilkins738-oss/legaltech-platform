import crypto from 'node:crypto';

export const DOCUMENT_SCAN_REQUIRED='SCAN_REQUIRED';
export const DOCUMENT_CLEAN_ISOLATED='CLEAN_ISOLATED';
const MAX_BYTES=15*1024*1024;
const MAX_ARCHIVE_ENTRIES=2000;
const MAX_ARCHIVE_UNCOMPRESSED=100*1024*1024;
const MAX_ARCHIVE_ENTRY=50*1024*1024;
const MAX_ARCHIVE_RATIO=200;
const activeOffice=/\.(?:docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|ppsm|sldm)$/i;
const nestedArchive=/\.(?:zip|7z|rar|gz|tgz|bz2|xz|iso|cab)$/i;
const officeTypes=new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const zipTypes=new Set(['application/zip','application/x-zip-compressed',...officeTypes]);
const textTypes=new Set(['text/plain','text/csv','message/rfc822']);
const plain=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=(value,max=512)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const quarantine=(reason,extra={})=>Object.freeze({verdict:'QUARANTINE',reason,...extra});
const scanRequired=extra=>Object.freeze({verdict:DOCUMENT_SCAN_REQUIRED,reason:'managed_scan_required',...extra});
function descriptors(value){if(!plain(value))throw new Error('DOCUMENT_SECURITY_INVALID');const d=Object.getOwnPropertyDescriptors(value);for(const key of Reflect.ownKeys(d))if(typeof key!=='string'||!Object.hasOwn(d[key],'value'))throw new Error('DOCUMENT_SECURITY_INVALID');return d;}
function field(d,key,fallback){return d[key]?.value===undefined?fallback:d[key].value;}
function normalizedType(value){if(typeof value!=='string'||value.length>255||/[\x00-\x1f\x7f]/.test(value))return null;return value.split(';',1)[0].trim().toLowerCase()||null;}
function utf8(bytes){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return !bytes.includes(0);}catch{return false;}}
function detected(bytes){
  if(bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from('%PDF')))return 'PDF';
  if(bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&[0x03,0x05,0x07].includes(bytes[2])&&[0x04,0x06,0x08].includes(bytes[3]))return 'ZIP';
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return 'PNG';
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'JPEG';
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])))return 'OLE';
  return utf8(bytes)?'TEXT':'UNKNOWN';
}
function expected(type){
  if(type==='application/pdf')return 'PDF';if(zipTypes.has(type))return 'ZIP';if(type==='image/png')return 'PNG';if(type==='image/jpeg'||type==='image/jpg')return 'JPEG';if(textTypes.has(type))return 'TEXT';return null;
}
function archiveMetadata(bytes){
  const start=Math.max(0,bytes.length-65557);let eocd=-1;
  for(let i=bytes.length-22;i>=start;i--){if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
  if(eocd<0||eocd+22>bytes.length)return quarantine('invalid_zip');
  const disk=bytes.readUInt16LE(eocd+4),centralDisk=bytes.readUInt16LE(eocd+6),entriesDisk=bytes.readUInt16LE(eocd+8),entries=bytes.readUInt16LE(eocd+10),centralSize=bytes.readUInt32LE(eocd+12),centralOffset=bytes.readUInt32LE(eocd+16),commentLength=bytes.readUInt16LE(eocd+20);
  if(disk||centralDisk||entriesDisk!==entries)return quarantine('multi_disk_archive');
  if(entries===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff)return quarantine('zip64_unsupported');
  if(entries>MAX_ARCHIVE_ENTRIES)return quarantine('archive_entry_limit');
  if(eocd+22+commentLength!==bytes.length||centralOffset+centralSize>eocd)return quarantine('invalid_zip');
  let p=centralOffset,total=0,maxEntry=0,maxRatio=0,nested=0;
  for(let index=0;index<entries;index++){
    if(p+46>bytes.length||bytes.readUInt32LE(p)!==0x02014b50)return quarantine('invalid_zip');
    const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),compressed=bytes.readUInt32LE(p+20),uncompressed=bytes.readUInt32LE(p+24),nameLen=bytes.readUInt16LE(p+28),extraLen=bytes.readUInt16LE(p+30),commentLen=bytes.readUInt16LE(p+32),external=bytes.readUInt32LE(p+38);
    const end=p+46+nameLen+extraLen+commentLen;if(end>bytes.length||end>centralOffset+centralSize)return quarantine('invalid_zip');
    if(flags&1)return quarantine('encrypted_archive');
    if(![0,8].includes(method))return quarantine('archive_compression_unsupported');
    const raw=bytes.subarray(p+46,p+46+nameLen),name=raw.toString('utf8');
    if(!Buffer.from(name,'utf8').equals(raw)||!name||name.includes('\0'))return quarantine('archive_name_invalid');
    const normalized=name.replace(/\\/g,'/');
    if(normalized.startsWith('/')||/^[A-Za-z]:/.test(normalized)||normalized.split('/').some(part=>part==='..'))return quarantine('archive_path_traversal');
    const mode=(external>>>16)&0xffff;if((mode&0xf000)===0xa000)return quarantine('archive_link');
    if(/(?:^|\/)vbaProject\.bin$/i.test(normalized))return quarantine('active_content');
    if(nestedArchive.test(normalized))nested++;
    total+=uncompressed;maxEntry=Math.max(maxEntry,uncompressed);const ratio=uncompressed/Math.max(1,compressed);maxRatio=Math.max(maxRatio,ratio);
    if(total>MAX_ARCHIVE_UNCOMPRESSED||maxEntry>MAX_ARCHIVE_ENTRY||(uncompressed>1024*1024&&ratio>MAX_ARCHIVE_RATIO))return quarantine('archive_decompression_limit');
    p=end;
  }
  if(p!==centralOffset+centralSize)return quarantine('invalid_zip');
  if(nested>0)return quarantine('nested_archive');
  return Object.freeze({entryCount:entries,totalUncompressed:total,maxEntryUncompressed:maxEntry,maxCompressionRatio:Number(maxRatio.toFixed(2)),nestedArchiveCount:nested});
}
export function inspectDocumentEnvelope(input){
  try{
    const d=descriptors(input),filename=field(d,'filename'),source=field(d,'bytes'),type=normalizedType(field(d,'contentType','application/octet-stream'));
    if(!text(filename,255)||(!Buffer.isBuffer(source)&&!(source instanceof Uint8Array))||!type)return quarantine('invalid_document_input');
    const bytes=Buffer.from(source),hash=sha(bytes),base={sha256:hash,size:bytes.length,contentType:type};
    if(bytes.length>MAX_BYTES)return quarantine('size_limit',base);
    if(activeOffice.test(filename))return quarantine('active_content',base);
    const kind=detected(bytes);base.detectedType=kind;
    if(kind==='OLE')return quarantine('legacy_compound_document',base);
    if(type==='application/octet-stream')return Object.freeze({verdict:'UNINSPECTED',reason:'content_type_unavailable',...base});
    const wanted=expected(type);if(!wanted)return quarantine('unsupported_content_type',base);if(kind!==wanted)return quarantine('mime_signature_mismatch',base);
    if(kind==='ZIP'){
      const archive=archiveMetadata(bytes);if(archive.verdict==='QUARANTINE')return quarantine(archive.reason,{...base,detectedType:kind});
      return scanRequired({...base,detectedType:kind,archive});
    }
    return scanRequired({...base,detectedType:kind});
  }catch{return quarantine('invalid_document_input');}
}
function evidenceRecord(value){const d=descriptors(value);return d;}
function evidenceText(d,key,max=200){const v=field(d,key);if(!text(v,max))throw new Error('DOCUMENT_SECURITY_EVIDENCE_INVALID');return v;}
function timestamp(d,key){const v=evidenceText(d,key,64);if(!Number.isFinite(Date.parse(v)))throw new Error('DOCUMENT_SECURITY_EVIDENCE_INVALID');return v;}
function descriptor(input){
  const d=descriptors(input),tenantId=evidenceText(d,'tenantId'),objectRef=evidenceText(d,'objectRef',512),hash=evidenceText(d,'sha256',64),size=field(d,'size'),contentType=normalizedType(field(d,'contentType')),envelope=field(d,'envelope');
  if(!/^[a-f0-9]{64}$/.test(hash)||!Number.isSafeInteger(size)||size<0||size>MAX_BYTES||!contentType||!plain(envelope)||envelope.verdict!==DOCUMENT_SCAN_REQUIRED||envelope.sha256!==hash||envelope.size!==size||envelope.contentType!==contentType||!objectRef.endsWith('/'+hash))throw new Error('DOCUMENT_SECURITY_DESCRIPTOR_INVALID');
  return Object.freeze({tenantId,objectRef,sha256:hash,size,contentType,detectedType:envelope.detectedType});
}
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function normalizeScan(raw,expected){
  const d=evidenceRecord(raw),result=evidenceText(d,'result',16),objectRef=evidenceText(d,'objectRef',512),hash=evidenceText(d,'sha256',64),size=field(d,'size'),scannerRef=evidenceText(d,'scannerRef'),engine=evidenceText(d,'engine'),engineVersion=evidenceText(d,'engineVersion'),definitionsVersion=evidenceText(d,'definitionsVersion'),scannedAt=timestamp(d,'scannedAt');
  if(!['CLEAN','INFECTED','ERROR'].includes(result)||objectRef!==expected.objectRef||hash!==expected.sha256||size!==expected.size)throw new Error('DOCUMENT_SECURITY_EVIDENCE_INVALID');
  return Object.freeze({result,objectRef,sha256:hash,size,scannerRef,engine,engineVersion,definitionsVersion,scannedAt});
}
function normalizeParse(raw,expected,scanFingerprint){
  const d=evidenceRecord(raw),result=evidenceText(d,'result',16),isolation=evidenceText(d,'isolation',32),objectRef=evidenceText(d,'objectRef',512),hash=evidenceText(d,'sha256',64),size=field(d,'size'),parserRef=evidenceText(d,'parserRef'),parserVersion=evidenceText(d,'parserVersion'),parsedAt=timestamp(d,'parsedAt'),boundScan=evidenceText(d,'scanFingerprint',64);
  if(!['OK','UNSUPPORTED','ERROR'].includes(result)||isolation!=='ISOLATED'||objectRef!==expected.objectRef||hash!==expected.sha256||size!==expected.size||boundScan!==scanFingerprint)throw new Error('DOCUMENT_SECURITY_EVIDENCE_INVALID');
  let outputRef=null,outputSha256=null,outputBytes=0,truncated=false;
  if(result==='OK'){
    outputRef=evidenceText(d,'outputRef',512);outputSha256=evidenceText(d,'outputSha256',64);outputBytes=field(d,'outputBytes');truncated=field(d,'truncated',false);
    if(!/^extract:\/\/[A-Za-z0-9._~:/-]+$/.test(outputRef)||!/^[a-f0-9]{64}$/.test(outputSha256)||!Number.isSafeInteger(outputBytes)||outputBytes<0||outputBytes>10*1024*1024||typeof truncated!=='boolean')throw new Error('DOCUMENT_SECURITY_EVIDENCE_INVALID');
  }
  return Object.freeze({result,isolation,objectRef,sha256:hash,size,parserRef,parserVersion,parsedAt,scanFingerprint:boundScan,outputRef,outputSha256,outputBytes,truncated});
}
export class HostileDocumentPipeline {
  #scanner;#parser;
  constructor({scanner,parser}){if(!scanner||typeof scanner.scan!=='function'||!parser||typeof parser.parse!=='function')throw new Error('DOCUMENT_SECURITY_PIPELINE_INVALID');this.#scanner=scanner;this.#parser=parser;}
  async assess(input){
    let d;try{d=descriptor(input);}catch{return quarantine('document_descriptor_invalid');}
    let scan;try{scan=normalizeScan(await this.#scanner.scan(d),d);}catch{return quarantine('malware_scan_evidence_invalid',{sha256:d.sha256,size:d.size,objectRef:d.objectRef});}
    const scanFingerprint=fingerprint(scan);
    if(scan.result!=='CLEAN')return quarantine(scan.result==='INFECTED'?'malware_detected':'malware_scan_failed',{sha256:d.sha256,size:d.size,objectRef:d.objectRef,scan,scanFingerprint});
    let parse;try{parse=normalizeParse(await this.#parser.parse(Object.freeze({...d,scanFingerprint})),d,scanFingerprint);}catch{return quarantine('parser_evidence_invalid',{sha256:d.sha256,size:d.size,objectRef:d.objectRef,scan,scanFingerprint});}
    if(parse.result!=='OK')return quarantine(parse.result==='UNSUPPORTED'?'parser_unsupported':'parser_failed',{sha256:d.sha256,size:d.size,objectRef:d.objectRef,scan,scanFingerprint,parse});
    const core={evidenceVersion:'v60',verdict:DOCUMENT_CLEAN_ISOLATED,sha256:d.sha256,size:d.size,objectRef:d.objectRef,contentType:d.contentType,detectedType:d.detectedType,scan,scanFingerprint,parse};
    return Object.freeze({...core,evidenceFingerprint:fingerprint(core)});
  }
  verifyEvidence(input,evidence){
    try{
      const d=descriptor(input),e=evidenceRecord(evidence);if(field(e,'evidenceVersion')!=='v60'||field(e,'verdict')!==DOCUMENT_CLEAN_ISOLATED||field(e,'sha256')!==d.sha256||field(e,'size')!==d.size||field(e,'objectRef')!==d.objectRef||field(e,'contentType')!==d.contentType||field(e,'detectedType')!==d.detectedType)return false;
      const scan=normalizeScan(field(e,'scan'),d),scanFingerprint=fingerprint(scan);if(field(e,'scanFingerprint')!==scanFingerprint||scan.result!=='CLEAN')return false;
      const parse=normalizeParse(field(e,'parse'),d,scanFingerprint);if(parse.result!=='OK')return false;
      const core={evidenceVersion:'v60',verdict:DOCUMENT_CLEAN_ISOLATED,sha256:d.sha256,size:d.size,objectRef:d.objectRef,contentType:d.contentType,detectedType:d.detectedType,scan,scanFingerprint,parse};return field(e,'evidenceFingerprint')===fingerprint(core);
    }catch{return false;}
  }
}
