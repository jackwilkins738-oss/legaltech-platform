const REF = /\b(?:CLM|MAT|REF)-?\d{3,}\b/gi;
export function extractRefs(text='') { return [...new Set((String(text).match(REF)||[]).map(x=>x.toUpperCase()))]; }
export function matchMatter({tenantId,subject='',body='',store}) {
  const refs=extractRefs(`${subject}\n${body}`); const found=[];
  let invalid=false;
  const identifier=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
  const bound=(matter,ref)=>matter&&typeof matter==='object'&&!Array.isArray(matter)&&matter.tenantId===tenantId&&identifier(matter.id)&&identifier(matter.externalId,512)&&Array.isArray(matter.externalRefs)&&matter.externalRefs.includes(ref);
  for(const ref of refs) {
    const rows=store.findMatterByExternalRef(tenantId,ref);
    if(!Array.isArray(rows))throw new Error('matter reference unavailable');
    for(const matter of rows) {
      if(!bound(matter,ref)){invalid=true;continue;}
      const current=store.getMatter(tenantId,matter.id);
      if(!bound(current,ref)||current.id!==matter.id||current.externalId!==matter.externalId){invalid=true;continue;}
      found.push({matterId:current.id,ref});
    }
  }
  const unique=[...new Map(found.map(x=>[x.matterId,x])).values()];
  if(invalid)return {decision:'REVIEW',matterId:null,refs,reason:'unverifiable_exact_reference',candidates:unique};
  if(unique.length===1) return {decision:'AUTO',matterId:unique[0].matterId,refs,reason:'single_exact_reference',candidates:unique};
  if(unique.length>1) return {decision:'REVIEW',matterId:null,refs,reason:'conflicting_exact_references',candidates:unique};
  return {decision:'REVIEW',matterId:null,refs,reason:refs.length?'reference_not_found':'no_exact_reference',candidates:[]};
}
