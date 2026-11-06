const variables=text=>[...text.matchAll(/\{[^{}]+\}/g)].map(match=>match[0]).sort();
export function validateBatch(sources,output){
 if(!Array.isArray(output)||output.length!==sources.length)throw new Error('Translation response has missing rows.');
 const expected=new Set(sources),seen=new Set();
 for(const item of output){
  if(!item||typeof item.source!=='string'||!expected.has(item.source)||seen.has(item.source))throw new Error('Unexpected or duplicate translation source.');
  seen.add(item.source);
  for(const locale of ['ceb','fil']){
   if(typeof item[locale]!=='string'||!item[locale].trim()||item[locale].length>30000)throw new Error('Missing or excessively long translation.');
   if(JSON.stringify(variables(item.source))!==JSON.stringify(variables(item[locale])))throw new Error('Translation changed interpolation placeholders.');
  }
 }
 return output;
}
