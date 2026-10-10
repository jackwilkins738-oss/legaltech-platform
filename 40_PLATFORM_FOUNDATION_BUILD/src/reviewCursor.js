import crypto from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const invalid=()=>new Error('REVIEW_CURSOR_INVALID'),AAD=Buffer.from('legaltech-review-cursor-v134');
export class ReviewCursorCodec {
  #key;#now;#ttl;
  constructor({key,now=()=>Date.now(),ttlMs=900000}={}){
    if(!Buffer.isBuffer(key)||key.length!==32||typeof now!=='function'||!Number.isInteger(ttlMs)||ttlMs<60000||ttlMs>3600000)throw invalid();
    this.#key=Buffer.from(key);this.#now=now;this.#ttl=ttlMs;Object.freeze(this);
  }
  #context(c){if(!c||typeof c.tenantId!=='string'||!UUID.test(c.tenantId)||typeof c.actorId!=='string'||!UUID.test(c.actorId)||!['PENDING','DECIDED','ALL'].includes(c.status))throw invalid();return [c.tenantId,c.actorId,c.status];}
  encode(after,c){if(typeof after!=='string'||!UUID.test(after))throw invalid();const context=this.#context(c),at=this.#now();if(!Number.isFinite(at))throw invalid();
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(AAD);
    const body=Buffer.concat([cipher.update(JSON.stringify({v:134,context,after,expires:at+this.#ttl}),'utf8'),cipher.final()]);
    return [iv,body,cipher.getAuthTag()].map(b=>b.toString('base64url')).join('.');
  }
  decode(token,c){const context=this.#context(c);if(typeof token!=='string'||token.length>1600||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw invalid();
    try{const parts=token.split('.'),[iv,body,tag]=parts.map(p=>Buffer.from(p,'base64url'));if(parts.some((p,i)=>[iv,body,tag][i].toString('base64url')!==p)||iv.length!==12||tag.length!==16)throw invalid();
      const d=crypto.createDecipheriv('aes-256-gcm',this.#key,iv);d.setAAD(AAD);d.setAuthTag(tag);const p=JSON.parse(Buffer.concat([d.update(body),d.final()]).toString('utf8')),at=this.#now();
      if(!p||Object.keys(p).length!==4||p.v!==134||JSON.stringify(p.context)!==JSON.stringify(context)||!UUID.test(p.after)||!Number.isFinite(at)||!Number.isFinite(p.expires)||p.expires<=at||p.expires>at+this.#ttl)throw invalid();return p.after;
    }catch{throw invalid();}
  }
}
