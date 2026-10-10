import {ReviewClient} from './reviewClient.js';
const el=id=>document.getElementById(id);
const errors={SIGN_IN_REQUIRED:'Your session expired. Sign in through your deployment, then refresh.',UNAVAILABLE:'This result is unavailable or access has changed.',CONFLICT:'The durable decision conflicts with this request. Refresh to inspect its current state.',INVALID_REQUEST:'The decision was rejected. Check the values and refresh.',READ_UNAVAILABLE:'Results are unavailable. Try refreshing.',OUTCOME_UNKNOWN:'The decision outcome is unverified. Retry the identical decision.'};
const labels={eventId:'Event',status:'Status',resultJobId:'Result job',resultHash:'Result hash',resultCode:'Result code',artifactHash:'Artifact hash',decision:'Decision',matterId:'Matter',writebackJobId:'Writeback intent job'};
function render(s){
  for(const id of ['status','refresh','next','choice','matter','source-reviewed','submit','retry'])el(id).disabled=s.busy||!!s.pending;
  el('retry').disabled=s.busy;el('next').disabled=s.busy||!!s.pending||!s.nextCursor;
  el('message').textContent=s.busy?'Waiting for the server…':s.error?errors[s.error]:s.receipt?s.receipt.decision==='APPROVE'?'Approval recorded. Writeback intent queued; execution remains paused.':'Rejection recorded.':s.items.length?`${s.items.length} result(s) in this scan.`:s.nextCursor?'No authorized results in this scan. Continue to the next page.':'No results in this scan.';
  el('items').replaceChildren();for(const item of s.items){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=`${item.eventId} · ${item.status} · ${item.resultCode}`;button.disabled=s.busy||!!s.pending;button.addEventListener('click',()=>run(()=>client.select(item.eventId)));li.append(button);el('items').append(li);}
  el('detail').hidden=!s.selected;el('metadata').replaceChildren();if(s.selected)for(const [key,label] of Object.entries(labels)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=s.selected[key]??'—';el('metadata').append(dt,dd);}
  el('decision').hidden=s.selected?.status!=='PROCESSED';el('retry-panel').hidden=!s.pending;
}
const client=new ReviewClient({onChange:render});
async function run(action){try{await action();}catch{el('message').textContent='Check the selection, matter UUID and source review confirmation. An unresolved decision must be retried first.';}}
el('browse').addEventListener('submit',event=>{event.preventDefault();el('source-reviewed').checked=false;run(()=>client.list({status:el('status').value}));});
el('next').addEventListener('click',()=>{el('source-reviewed').checked=false;run(()=>client.list({next:true}));});
el('items').addEventListener('click',()=>{el('source-reviewed').checked=false;el('matter').value='';});
el('decision').addEventListener('submit',event=>{event.preventDefault();run(()=>client.decide({decision:el('choice').value,matterId:el('choice').value==='APPROVE'?el('matter').value:null,sourceReviewed:el('source-reviewed').checked}));});
el('retry').addEventListener('click',()=>run(()=>client.retry()));
window.addEventListener('pagehide',()=>{client.dispose();render(client.state());});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
render(client.state());run(()=>client.list());
