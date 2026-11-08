/** Bound read requests without changing mutation/retry semantics. */
export const fetchReadBounded:typeof fetch=(input,init:RequestInit={})=>{
 const method=(init.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();
 return fetch(input,{...init,signal:init.signal||(['GET','HEAD'].includes(method)?AbortSignal.timeout(25000):undefined)});
};
