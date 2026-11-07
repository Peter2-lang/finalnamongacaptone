/** Apply only complete catalog entries; unresolved copy remains auditable. */
import fs from 'node:fs';
import path from 'node:path';
import {componentFiles,inspectUi} from './ui-source.mjs';
import {existingSources} from './catalog.mjs';
const known=existingSources();let changed=0,localized=0;
for(const file of componentFiles()){
 const source=fs.readFileSync(file,'utf8'),{sites}=inspectUi(file,source),edits=[];const names=new Set();
 for(const site of sites){
  if(site.deferred||site.kind==='localized'||!known.has(site.source))continue;
  const quote=JSON.stringify(site.kind==='text'?site.source:site.rawSource);
  let text;
  if(site.kind==='text'){
   // Only string expressions are used in <option>; React components are invalid there.
   const before=source.slice(0,site.start);const inOption=before.lastIndexOf('<option')>before.lastIndexOf('</option>');
   const raw=source.slice(site.start,site.end),leading=/^\s/.test(raw)&&!raw.includes('\n')?'{" "}':'',trailing=/\s$/.test(raw)&&!raw.includes('\n')?'{" "}':'';
   text=inOption?`{translateInterfaceText(${quote})}`:`${leading}<InterfaceText source=${quote} />${trailing}`;names.add(inOption?'translateInterfaceText':'InterfaceText');
  }else{
   const args=site.values?`, {${site.values.map((value,index)=>`arg${index}: ${value}`).join(', ')}}`:'';
   text=`translateInterfaceText(${quote}${args})`;if(site.kind==='attribute')text=`{${text}}`;if(site.kind==='property')text=`get ${site.property}(){return ${text};}`;names.add('translateInterfaceText');
  }
  edits.push({...site,text});
 }
 if(!edits.length)continue;
 let next=source,lastStart=Infinity;
 for(const edit of edits.sort((a,b)=>b.start-a.start)){
  if(edit.end>lastStart)throw new Error(`Overlapping localization edits: ${file}:${edit.line}`);
  next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);lastStart=edit.start;localized++;
 }
 let relative=path.relative(path.dirname(file),'src/i18n/interfaceText').replaceAll('\\','/');if(!relative.startsWith('.'))relative='./'+relative;
 const match=next.match(/import \{ ([^}]+) \} from ['"][^'"]*i18n\/interfaceText['"];?/);
 if(match){const merged=[...new Set([...match[1].split(',').map(name=>name.trim()),...names])];next=next.replace(match[0],`import { ${merged.join(', ')} } from '${relative}';`);}else next=`import { ${[...names].join(', ')} } from '${relative}';\n`+next;
 fs.writeFileSync(file,next);changed++;
}
console.log(JSON.stringify({changed,localized}));
