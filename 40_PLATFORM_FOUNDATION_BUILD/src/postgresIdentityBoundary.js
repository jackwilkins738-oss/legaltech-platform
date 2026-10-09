import {PostgresServerSessionStore} from './postgresSessions.js';
import {ProductionOidcAuthProvider,SessionCookieAuthProvider,IdentitySessionService} from './productionIdentity.js';

// Composes the shared session path only. Other production providers remain mandatory.
export function createPostgresIdentityBoundary({brokerPool,expectedBrokerRole,resolveIdentity,providerNamespace,oidcAuthProvider,allowedOrigin,securityInterlock,absoluteTtlMs,idleTtlMs,timeoutMs}={}) {
  if(!(oidcAuthProvider instanceof ProductionOidcAuthProvider)||typeof securityInterlock?.assertAllowed!=='function')throw new Error('SHARED_IDENTITY_BOUNDARY_CONFIGURATION_INVALID');
  const sessionStore=new PostgresServerSessionStore({brokerPool,expectedRole:expectedBrokerRole,resolveIdentity,providerNamespace,absoluteTtlMs,idleTtlMs,timeoutMs});
  const authProvider=new SessionCookieAuthProvider({store:sessionStore,allowedOrigin});
  const identitySessionService=new IdentitySessionService({oidcAuthProvider,sessionStore,allowedOrigin,securityInterlock});
  return Object.freeze({sessionStore,authProvider,identitySessionService,sessionProbe:options=>sessionStore.probe(options)});
}
