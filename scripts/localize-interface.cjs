// Migrate known static JSX labels only. Never rewrites database values, input
// values, URL destinations, enum values, or arbitrary expressions.
const ts=require('typescript'),fs=require('fs'),path=require('path');
const labels=fs.readFileSync('src/i18n/interfaceLabels.ts','utf8').split('`')[1].trim().split('\n').map(line=>line.split('|')[0]);
const enSource=ts.createSourceFile('en.ts',fs.readFileSync('src/i18n/en.ts','utf8'),99,true);
const known=new Set(labels);function collect(n){if(ts.isPropertyAssignment(n)&&ts.isStringLiteral(n.initializer))known.add(n.initializer.text);ts.forEachChild(n,collect)}collect(enSource);
let changed=0,translated=0;const missing=new Map();
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(file.endsWith('.tsx')){
 const src=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,src,99,true,4),edits=[];let needText=false,needString=false;
 function visit(n){
  if(ts.isJsxText(n)){
   const text=n.text.replace(/\s+/g,' ').trim();
   if(/[A-Za-z]{2}/.test(text)){
    if(known.has(text)){
     const lines=n.text.split(/\r?\n/);const leading=lines.length===1&&/^\s/.test(n.text)?'{" "}':'';const trailing=lines.length===1&&/\s$/.test(n.text)?'{" "}':'';
     edits.push([n.pos,n.end,`${leading}<InterfaceText source=${JSON.stringify(text)} />${trailing}`]);needText=true;translated++;
    }else missing.set(text,(missing.get(text)||[]).concat(file));
   }
  } else if(ts.isJsxAttribute(n)&&['title','placeholder','aria-label','alt'].includes(n.name.getText(ast))&&n.initializer&&ts.isStringLiteral(n.initializer)&&known.has(n.initializer.text)){
   edits.push([n.initializer.getStart(ast),n.initializer.end,`{translateInterfaceText(${JSON.stringify(n.initializer.text)})}`]);needString=true;
  }
  ts.forEachChild(n,visit);
 }
 visit(ast);if(edits.length){let next=src;for(const [a,b,value] of edits.sort((a,b)=>b[0]-a[0]))next=next.slice(0,a)+value+next.slice(b);const names=[...(needText?['InterfaceText']:[]),...(needString?['translateInterfaceText']:[])];let relative=path.relative(path.dirname(file),'src/i18n/interfaceText').replaceAll('\\','/');if(!relative.startsWith('.'))relative='./'+relative;const match=next.match(/import \{ ([^}]+) \} from ['"][^'"]*i18n\/interfaceText['"];?/);if(match){const merged=[...new Set([...match[1].split(',').map(value=>value.trim()),...names])];next=next.replace(match[0],`import { ${merged.join(', ')} } from '${relative}';`);}else next=`import { ${names.join(', ')} } from '${relative}';\n`+next;fs.writeFileSync(file,next);changed++;}
}}}
walk('src/components');
fs.mkdirSync('docs/audits',{recursive:true});fs.writeFileSync('docs/audits/interface-translation-gaps.json',JSON.stringify(Object.fromEntries([...missing].sort()),null,2)+'\n');console.log({changed,translated,remainingStaticPhrases:missing.size});
