// Synchronous reference services cannot safely consume a remote/async gate.
export function assertSynchronousInterlock(interlock,input) {
  if(!interlock)return;
  const value=interlock.assertAllowed(input);
  if(value&&typeof value.then==='function'){
    Promise.resolve(value).catch(()=>{});
    throw new Error('ASYNC_SECURITY_INTERLOCK_REQUIRED');
  }
  if(value!==true)throw new Error('SECURITY_INTERLOCK_UNAVAILABLE');
}
