import {readFileSync} from 'node:fs';
import {appError} from './errors.js';
const assets=Object.freeze(Object.fromEntries([['/review','reviewPage.html','text/html; charset=utf-8'],['/review/assets/review.css','review.css','text/css; charset=utf-8'],['/review/assets/reviewPage.js','reviewPage.js','text/javascript; charset=utf-8'],['/review/assets/reviewClient.js','reviewClient.js','text/javascript; charset=utf-8']].map(([path,file,type])=>[path,Object.freeze({type,bytes:readFileSync(new URL('../browser/'+file,import.meta.url))})])));
export function reviewUiConfig(config){
  if(config===undefined)return null;
  const d=config&&Object.getOwnPropertyDescriptors(config);if(!config||Object.getPrototypeOf(config)!==Object.prototype||Reflect.ownKeys(config).length!==1||!Object.hasOwn(d.allowedOrigin??{},'value'))throw Error('REVIEW_UI_CONFIGURATION_INVALID');
  if(typeof d.allowedOrigin.value!=='string')throw Error('REVIEW_UI_CONFIGURATION_INVALID');
  let u;try{u=new URL(d.allowedOrigin.value);}catch{throw Error('REVIEW_UI_CONFIGURATION_INVALID');}
  if(u.protocol!=='https:'||u.origin!==d.allowedOrigin.value||u.username||u.password)throw Error('REVIEW_UI_CONFIGURATION_INVALID');return Object.freeze({origin:u.origin});
}
export function reviewBrowserGuard(req,config){
  if(req.headers.origin!==undefined&&req.headers.origin!==config.origin||req.headers['sec-fetch-site']!==undefined&&req.headers['sec-fetch-site']!=='same-origin'&&!(req.method==='GET'&&req.headers['sec-fetch-site']==='none'))throw appError('resource unavailable',{status:403,code:'BROWSER_ORIGIN_DENIED'});
  if(req.method==='POST'&&(req.headers.origin!==config.origin||req.headers['x-review-ui']!=='1'))throw appError('resource unavailable',{status:403,code:'BROWSER_ORIGIN_DENIED'});
}
export const reviewAsset=path=>assets[path]??null;
export function sendReviewAsset(res,asset,traceId,{documentAvailable=false}={}){
  if(res.destroyed||res.writableEnded)return;
  const bytes=asset.type.startsWith('text/html')?Buffer.from(asset.bytes.toString('utf8').replace('data-available="false"',`data-available="${documentAvailable?'true':'false'}"`)):asset.bytes;
  res.writeHead(200,{'content-type':asset.type,'content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-trace-id':traceId,'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','cross-origin-opener-policy':'same-origin','permissions-policy':'camera=(), microphone=(), geolocation=()'});res.end(bytes);
}
