// Keep public error metadata private: adapter-shaped Errors are not client errors.
const publicErrors = new WeakMap();
export function appError(message,{status=400,code='BAD_REQUEST'}={}) {
  const error=Object.assign(new Error(message),{status,code});
  const valid=Number.isInteger(status)&&status>=400&&status<=599&&typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(code);
  publicErrors.set(error,Object.freeze(valid&&status<500
    ? {status,code,message:error.message}
    : {status:valid?status:500,code:'INTERNAL_ERROR',message:'internal error'}));
  return error;
}
export function publicError(error) {
  return publicErrors.get(error)??{status:500,code:'INTERNAL_ERROR',message:'internal error'};
}
