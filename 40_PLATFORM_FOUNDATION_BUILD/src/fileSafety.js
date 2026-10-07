const executableMagics=[Buffer.from([0x4d,0x5a]),Buffer.from([0x7f,0x45,0x4c,0x46])];
const blockedExt=/\.(?:exe|dll|js|vbs|ps1|bat|cmd|scr|com|msi)$/i;
export function inspectFile({filename='',bytes,maxBytes=15*1024*1024}) {
  const buf=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes||'');
  if(buf.length>maxBytes) return {verdict:'QUARANTINE',reason:'size_limit'};
  // Check the filename aliases before assigning a parser-safe verdict.
  if(typeof filename!=='string'||/[\\/:]/.test(filename)) return {verdict:'QUARANTINE',reason:'unsafe_filename'};
  const canonical=filename.replace(/[ .]+$/g,'');
  if(blockedExt.test(canonical)) return {verdict:'QUARANTINE',reason:'blocked_extension'};
  if(executableMagics.some(m=>buf.subarray(0,m.length).equals(m))) return {verdict:'QUARANTINE',reason:'executable_content'};
  return {verdict:'SAFE_FOR_PARSER',reason:'basic_checks_passed'};
}
