import ts from 'typescript';
import fs from 'node:fs';
import {collectUi} from './ui-source.mjs';
export const catalogPath='src/i18n/extendedLabels.json';
export function existingSources(){
 const source=fs.readFileSync('src/i18n/en.ts','utf8'),ast=ts.createSourceFile('en.ts',source,99,true),entries=new Set();
 const visit=node=>{if(ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.initializer))entries.add(node.initializer.text);ts.forEachChild(node,visit);};visit(ast);
 for(const line of fs.readFileSync('src/i18n/interfaceLabels.ts','utf8').split('`')[1].trim().split('\n'))entries.add(line.split('|')[0]);
 const extended=JSON.parse(fs.readFileSync(catalogPath,'utf8'));for(const [key,value] of Object.entries(extended))if(value.ceb&&value.fil)entries.add(key);
 return entries;
}
export function translationInput(){
 const {sites,preserved}=collectUi(),existing=existingSources(),pending={};
 for(const site of sites)if(!existing.has(site.source)){const item=pending[site.source]||{source:site.source,locations:[]};item.locations.push({file:site.file,line:site.line,kind:site.kind});pending[site.source]=item;}
 return {pending:Object.values(pending),preserved};
}
if(process.argv[1]?.endsWith('/catalog.mjs')){
 const result=translationInput();fs.mkdirSync('docs/audits',{recursive:true});
 fs.writeFileSync('docs/audits/translation-worklist.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({phrases:result.pending.length,preservedDocumentLocations:result.preserved.length}));
}
