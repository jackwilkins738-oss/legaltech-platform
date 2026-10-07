export function appError(message,{status=400,code='BAD_REQUEST'}={}) {
  return Object.assign(new Error(message),{status,code});
}
