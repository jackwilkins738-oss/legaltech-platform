const executableMagics = [
  Buffer.from([0x4d,0x5a]), // MZ
  Buffer.from([0x7f,0x45,0x4c,0x46]) // ELF
];

export function inspectUpload({ filename='', bytes }) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  const lower = filename.toLowerCase();
  const looksExecutable = executableMagics.some(m => buf.subarray(0,m.length).equals(m));
  if (looksExecutable) return { verdict:'QUARANTINE', reason:'executable_content' };
  if (buf.length > 15 * 1024 * 1024) return { verdict:'QUARANTINE', reason:'size_limit' };
  if (lower.endsWith('.exe') || lower.endsWith('.dll') || lower.endsWith('.js')) return { verdict:'QUARANTINE', reason:'blocked_extension' };
  return { verdict:'SAFE_FOR_PARSER', reason:'basic_checks_passed' };
}
