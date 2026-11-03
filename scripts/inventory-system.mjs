import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n');
const files=[], actions=[],routes=[];
const clean=value=>value.replace(/\s+/g,' ').trim();
for(const path of [...new Set(paths)].filter(p=>!p.startsWith('docs/audit/')&&/\.(?:tsx?|m?js|sql|json|md)$/.test(p)&&!p.endsWith('package-lock.json'))){
 const text=readFileSync(path,'utf8');
 files.push({path,sha256:createHash('sha256').update(text).digest('hex'),lines:text.split('\n').length});
 if(!/\.[cm]?[jt]sx?$/.test(path)||path.includes('.test.'))continue;
 const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const location=node=>source.getLineAndCharacterOfPosition(node.getStart()).line+1;
 const add=(node,kind,action,handler='')=>actions.push({module:path,kind,action:clean(action).slice(0,200),handler:clean(handler).slice(0,350),line:location(node),status:'NOT VERIFIED'});
 const visit=node=>{
  if(ts.isJsxAttribute(node)&&/^on(?:Click|Submit|Change|Select|Drop|DragEnd|KeyDown)$/.test(node.name.getText(source))){
   const control=node.parent.parent;
   const parent=control.parent;
   const label=ts.isJsxElement(parent)?parent.children.filter(c=>ts.isJsxText(c)).map(c=>c.getText(source)).join(' '):'';
   add(node,'UI '+node.name.getText(source),label||control.getText(source).slice(0,180),node.initializer?.getText(source)||'');
  }
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(source)==='app'&&['get','post','put','patch','delete','all'].includes(node.expression.name.text)){
   const arg=node.arguments[0];const targets=ts.isArrayLiteralExpression(arg)?arg.elements:[arg];
   for(const target of targets)if(ts.isStringLiteral(target))routes.push({method:node.expression.name.text.toUpperCase(),path:target.text,source:path,line:location(node),status:'NOT VERIFIED'});
  }
  if(ts.isFunctionDeclaration(node)&&node.name&&node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))add(node,'exported function',node.name.text);
  if((path.includes('/services/')||path.includes('/hooks/'))&&ts.isMethodDeclaration(node))add(node,'service method',node.name.getText(source));
  ts.forEachChild(node,visit);
 };visit(source);
}
const components=files.filter(f=>f.path.startsWith('src/components/')&&f.path.endsWith('.tsx')).map(f=>({path:f.path,actions:actions.filter(a=>a.module===f.path).length,status:'NOT VERIFIED'}));
mkdirSync('docs/audit',{recursive:true});
const inventory={scope:'Static source inventory; discovery is not functional verification',files,components,routes,actions};
writeFileSync('docs/audit/system-inventory.json',JSON.stringify(inventory,null,2)+'\n');
const esc=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ');
const rows=[...actions.map(a=>[a.module,`${a.kind}: ${a.action} (L${a.line})`]),...routes.map(r=>[r.source,`${r.method} ${r.path} (L${r.line})`])];
writeFileSync('docs/audit/action-register.md',`# Full source action register\n\n${files.length} source/config/SQL/document files inventoried; ${components.length} components; ${routes.length} route registrations; ${actions.length} UI/service/function actions. This is a static discovery register. Each unexercised action remains NOT VERIFIED. See system-audit.md for executed scenario evidence and blockers; a unit test never promotes every UI action in its module to PASS.\n\n| Module | Feature / Action | Initial Result | Issue Found | Fix Applied | Final Test | Status |\n| --- | --- | --- | --- | --- | --- | --- |\n`+rows.map(([module,action])=>`| ${esc(module)} | ${esc(action)} | Inspected source | Functional behavior requires scenario test | See scenario report for confirmed fixes | Not individually exercised | NOT VERIFIED |`).join('\n')+'\n');
console.log(JSON.stringify({files:files.length,components:components.length,routes:routes.length,actions:actions.length}));
