import {PostgresSecurityInterlock} from './postgresInterlock.js';
import {PostgresAbuseLimiter} from './postgresAbuseControl.js';

export function createPostgresOperationalSecurity({readerPool,expectedReaderRole,limiterPool,expectedLimiterRole,hashKey,ratePolicy={},timeoutMs=5000}={}) {
  const securityInterlock=new PostgresSecurityInterlock({pool:readerPool,expectedRole:expectedReaderRole,timeoutMs});
  if(!ratePolicy||Object.getPrototypeOf(ratePolicy)!==Object.prototype||Reflect.ownKeys(ratePolicy).some(k=>!['windowMs','maxPerIp','maxPerTenant','maxReadRecordsPerActor','maxDistinctMattersPerActor'].includes(k)))throw new Error('SHARED_SECURITY_CONFIGURATION_INVALID');
  const abuseLimiter=new PostgresAbuseLimiter({...ratePolicy,pool:limiterPool,expectedRole:expectedLimiterRole,hashKey,timeoutMs});
  return Object.freeze({securityInterlock,abuseLimiter,interlockProbe:()=>securityInterlock.probe(),rateLimitProbe:()=>abuseLimiter.probe()});
}
