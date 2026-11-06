import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const gaps=new Map(), keyGaps=new Map(), englishKeys=new Set();
const english=ts.createSourceFile('en.ts',fs.readFileSync('src/i18n/en.ts','utf8'),ts.ScriptTarget.Latest,true);
function collectKeys(node){if(ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.initializer))englishKeys.add(node.name.getText(english).replace(/^['"]|['"]$/g,''));ts.forEachChild(node,collectKeys);}collectKeys(english);
const labels=fs.readFileSync('src/i18n/interfaceLabels.ts','utf8').split('`')[1].trim().split('\n').map(line=>line.split('|')[0]);
for(const label of labels)englishKeys.add(`ui.${label}`);
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(file.endsWith('.tsx')){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(node){
  if(ts.isCallExpression(node)&&(ts.isIdentifier(node.expression)&&node.expression.text==='t'||ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='t')&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
   const key=node.arguments[0].text;
   if(!englishKeys.has(key))keyGaps.set(key,[...new Set([...(keyGaps.get(key)||[]),file])]);
  }
  if(ts.isJsxText(node)){const text=node.text.replace(/\s+/g,' ').trim();if(/[A-Za-z]{2}/.test(text)&&!/^(&\w+;|[A-Z]{1,5}|px|kg|km|Brgy\.|English|Bisaya|Tagalog)$/.test(text))gaps.set(text,[...new Set([...(gaps.get(text)||[]),file])]);}ts.forEachChild(node,visit);}visit(ast);
}}}
walk('src/components');
fs.mkdirSync('docs/audits',{recursive:true});
fs.writeFileSync('docs/audits/interface-translation-gaps.json',JSON.stringify(Object.fromEntries([...gaps].sort()),null,2)+'\n');
fs.writeFileSync('docs/audits/translation-key-gaps.json',JSON.stringify(Object.fromEntries([...keyGaps].sort()),null,2)+'\n');
console.log(`${keyGaps.size} literal translation keys are missing from the English catalog; see docs/audits/translation-key-gaps.json`);
console.log(`${gaps.size} distinct static JSX phrases still need translation review; see docs/audits/interface-translation-gaps.json`);
if(process.argv.includes('--check')&&(gaps.size||keyGaps.size))process.exitCode=1;
