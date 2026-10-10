// Pinned migration 055 function bodies; catalog tampering closes admission.
export const DRAIN_FUNCTION_HASHES=Object.freeze(Object.fromEntries(Object.entries({
  "assert_access": {
    "hash": "5d9cea353c7456a622c68151c10e5b88b8a6deabb6f8d1740a13ec85bbd76bcf",
    "arguments": "deployment text, mode text"
  },
  "status_json": {
    "hash": "1c4d26b949d0f2e829687c43de68e0e36f78b59919c721aef92cb95d76f919de",
    "arguments": "deployment text"
  },
  "operate": {
    "hash": "9adfb3ef47e1a35dcb848c551029ba8fa615733e6b5134ce68bca21d45dbf968",
    "arguments": "deployment text, action text, input jsonb"
  }
}).map(([name,value])=>[name,Object.freeze(value)])));
