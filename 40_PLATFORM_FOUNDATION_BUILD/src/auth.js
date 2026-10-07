import crypto from 'node:crypto';
import {appError} from './errors.js';

export class StaticAuthProvider {
  constructor(sessions = []) {
    this.sessions = new Map(sessions.map((session) => [session.token, structuredClone(session)]));
  }

  async authenticate(headers) {
    const raw = headers.authorization || headers.Authorization;
    if (!raw || !raw.startsWith('Bearer ')) {
      throw appError('authentication required', {status: 401, code: 'AUTH_REQUIRED'});
    }
    const token = raw.slice('Bearer '.length).trim();
    const session = this.sessions.get(token);
    if (!session) throw appError('authentication required', {status: 401, code: 'AUTH_REQUIRED'});
    return {
      actorId: session.actorId,
      tenantId: session.tenantId,
      roles: [...(session.roles || [])],
      capabilities: [...(session.capabilities || [])],
      sessionId: session.sessionId || `ses_${crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)}`,
    };
  }
}

export function requireCapability(session, capability) {
  if (!session?.capabilities?.includes(capability)) {
    throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
  }
}

// Production-shape mapper only. Signature/issuer/audience verification MUST happen in the upstream OIDC middleware.
// This class deliberately refuses raw bearer strings and accepts only a verified claims object supplied by trusted server code.
export class VerifiedOidcClaimsMapper {
  constructor({tenantClaim='tenant_id',actorClaim='sub',rolesClaim='roles',capabilitiesClaim='capabilities'}={}) { Object.assign(this,{tenantClaim,actorClaim,rolesClaim,capabilitiesClaim}); }
  mapVerifiedClaims(claims) {
    if (!claims || claims.__verified !== true) throw appError('verified oidc claims required',{status:401,code:'OIDC_VERIFICATION_REQUIRED'});
    const tenantId=claims[this.tenantClaim],actorId=claims[this.actorClaim];
    if (!tenantId || !actorId) throw appError('required oidc claims missing',{status:401,code:'OIDC_CLAIMS_INVALID'});
    return {tenantId:String(tenantId),actorId:String(actorId),roles:Array.isArray(claims[this.rolesClaim])?[...claims[this.rolesClaim]]:[],capabilities:Array.isArray(claims[this.capabilitiesClaim])?[...claims[this.capabilitiesClaim]]:[],sessionId:claims.sid||`oidc_${crypto.randomUUID()}`};
  }
}
