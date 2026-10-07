function norm(v=''){ return String(v).toLowerCase().replace(/[^a-z0-9]/g,''); }

export function matchMatter(email, matters) {
  const text = `${email.subject||''} ${email.body||''}`;
  const candidates=[];
  for (const m of matters) {
    let score=0; const signals=[]; const conflicts=[];
    if (m.claim_reference && text.includes(m.claim_reference)) { score+=0.8; signals.push('EXACT_CLAIM_REFERENCE'); }
    if (m.client_name && norm(text).includes(norm(m.client_name))) { score+=0.25; signals.push('CLIENT_NAME'); }
    if (m.insurer && norm(text).includes(norm(m.insurer))) { score+=0.05; signals.push('INSURER'); }
    if (score>0) candidates.push({matter_id:m.matter_id,score:Math.min(score,1),signals,conflicts});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const exact=candidates.filter(c=>c.signals.includes('EXACT_CLAIM_REFERENCE'));
  const adversarial=/ignore all prior instructions|search every client|exfiltrat|send .*client file/i.test(text);
  if (adversarial) return {decision:'BLOCK',candidates,reason:'ADVERSARIAL_CONTENT'};
  if (exact.length>1) return {decision:'REVIEW',candidates,reason:'CONFLICTING_REFERENCES'};
  if (candidates.length===0) return {decision:'NO_MATCH',candidates,reason:'NO_CANDIDATE'};
  if (candidates[0].score>=0.8 && (!candidates[1] || candidates[0].score-candidates[1].score>=0.3)) {
    return {decision:'AUTO',candidates,reason:'STRONG_DETERMINISTIC_MATCH'};
  }
  return {decision:'REVIEW',candidates,reason:'AMBIGUOUS'};
}
