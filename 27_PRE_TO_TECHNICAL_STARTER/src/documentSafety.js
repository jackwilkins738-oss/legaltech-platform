const EXECUTABLE_MAGIC = [
  Buffer.from([0x4d,0x5a]), // PE/DOS
  Buffer.from([0x7f,0x45,0x4c,0x46]) // ELF
];

export function inspectDocument({filename,bytes,maxBytes=10_000_000}) {
  if (!Buffer.isBuffer(bytes)) throw new Error('bytes must be Buffer');
  if (bytes.length>maxBytes) return {state:'QUARANTINE',reason:'OVERSIZE'};
  for (const sig of EXECUTABLE_MAGIC) {
    if (bytes.subarray(0,sig.length).equals(sig)) return {state:'QUARANTINE',reason:'EXECUTABLE_SIGNATURE'};
  }
  if (/\.(exe|dll|scr|bat|cmd|ps1|js)$/i.test(filename)) return {state:'QUARANTINE',reason:'DISALLOWED_EXTENSION'};
  return {state:'SAFE_FOR_NEXT_STAGE',reason:'BASIC_PRECHECK_ONLY'};
}
