import ts from 'typescript';
import fs from 'node:fs';
import {collectUi,componentFiles} from './i18n/ui-source.mjs';
import {existingSources} from './i18n/catalog.mjs';
const {sites,preserved}=collectUi(),known=existingSources(),gaps=new Map(),keyGaps=new Map(),englishKeys=new Set();
const english=ts.createSourceFile('en.ts',fs.readFileSync('src/i18n/en.ts','utf8'),99,true);
const visitEnglish=node=>{if(ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.initializer))englishKeys.add(node.name.getText(english).replace(/^['"]|['"]$/g,''));ts.forEachChild(node,visitEnglish);};visitEnglish(english);
for(const source of known)englishKeys.add(`ui.${source}`);
for(const file of componentFiles()){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),99,true,4);
 const visit=node=>{
  if(ts.isCallExpression(node)&&(ts.isIdentifier(node.expression)&&node.expression.text==='t'||ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='t')&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
   const key=node.arguments[0].text;if(!englishKeys.has(key))keyGaps.set(key,[...new Set([...(keyGaps.get(key)||[]),file])]);
  }
  ts.forEachChild(node,visit);
 };
 visit(ast);
}
for(const site of sites)if(!known.has(site.source))gaps.set(site.source,[...new Set([...(gaps.get(site.source)||[]),site.file])]);
fs.mkdirSync('docs/audits',{recursive:true});
fs.writeFileSync('docs/audits/interface-translation-gaps.json',JSON.stringify(Object.fromEntries([...gaps].sort()),null,2)+'\n');
fs.writeFileSync('docs/audits/translation-key-gaps.json',JSON.stringify(Object.fromEntries([...keyGaps].sort()),null,2)+'\n');
fs.writeFileSync('docs/audits/preserved-document-copy.json',JSON.stringify(preserved.map(({file,line,source,reason})=>({file,line,source,reason})),null,2)+'\n');
console.log(`${keyGaps.size} missing translation keys; ${gaps.size} unresolved UI phrases (text, attributes, templates and feedback).`);
console.log(`${preserved.length} document/code locations preserved explicitly. No database values were scanned.`);
if(process.argv.includes('--check')&&(gaps.size||keyGaps.size))process.exitCode=1;
