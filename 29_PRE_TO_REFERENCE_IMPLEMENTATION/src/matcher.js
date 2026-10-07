const REF = /\b(?:CLM|MAT|REF)-?\d{3,}\b/gi;

export function extractRefs(text='') {
  return [...new Set((text.match(REF) || []).map(x => x.toUpperCase()))];
}

export function matchMatter({ tenantId, subject='', body='', store }) {
  const refs = extractRefs(`${subject}\n${body}`);
  const found = [];
  for (const ref of refs) {
    for (const m of store.findMatterByExternalRef(tenantId, ref)) {
      found.push({matterId:m.id, ref});
    }
  }
  const unique = [...new Map(found.map(x => [x.matterId, x])).values()];
  if (unique.length === 1) return { decision:'AUTO', matterId:unique[0].matterId, refs, reason:'single_exact_reference' };
  if (unique.length > 1) return { decision:'REVIEW', matterId:null, refs, reason:'conflicting_exact_references', candidates:unique };
  return { decision:'REVIEW', matterId:null, refs, reason:refs.length ? 'reference_not_found' : 'no_exact_reference', candidates:[] };
}
