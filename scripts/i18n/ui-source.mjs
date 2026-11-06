import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

export const preservedDocumentFiles=new Set(['src/components/certificate/BarangayCertificateView.tsx','src/components/certificate/DynamicCertificateView.tsx']);
const tokens=new Set(['API','GIS','ASF','DA','RSBSA','SQL','JSON','CSV','XLSX','XLS','HTML','CSS','URL','PDF','PHP','GPS','UTC','EN','CEB','FIL','SLSU','px','kg','km','cm','m','Brgy.','Facebook','YouTube','Bagong Pilipinas','Hinunangan','Southern Leyte']);
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’',bull:'•',ndash:'–',mdash:'—',hellip:'…',copy:'©',times:'×'};
export function decodeEntities(text){return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(match,key)=>key[0]==='#'?String.fromCodePoint(key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1))):entities[key]??match);}
export function jsxText(text){
 const lines=text.replace(/\t/g,' ').split(/\r\n|\n|\r/);let last=0;
 lines.forEach((line,index)=>{if(/[^ ]/.test(line))last=index;});
 return decodeEntities(lines.map((line,index)=>{if(index!==0)line=line.replace(/^ +/,'');if(index!==lines.length-1)line=line.replace(/ +$/,'');return line+(line&&index!==last?' ':'');}).join(''));
}
export const needsTranslation=text=>/[A-Za-z]{2}/.test(text)&&!tokens.has(text.trim())&&!/^(?:https?:\/\/|\/[^ ]+\.(?:svg|png|jpg)|#[0-9a-f]{3,8}$)/i.test(text.trim());
const outputAttributes=new Set(['title','placeholder','aria-label','alt','label','subtitle','description','message']);
function documentAncestor(node){
 for(let current=node.parent;current;current=current.parent){
  if(ts.isJsxElement(current)){
   const tag=current.openingElement.tagName.getText();if(['code','pre','script','style'].includes(tag))return 'literal/code content';
   const attr=current.openingElement.attributes.properties.find(item=>ts.isJsxAttribute(item)&&item.name.getText()==='data-print-document');
   if(attr&&ts.isStringLiteral(attr.initializer)&&['certificate','transmittal'].includes(attr.initializer.text))return 'official document body';
  }
 }
 return null;
}
export function inspectUi(file,source=fs.readFileSync(file,'utf8')){
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),sites=[],preserved=[];
 const add=(node,text,kind,extra={})=>{
  const sourceText=text.trim();if(!needsTranslation(sourceText))return;
  const reason=preservedDocumentFiles.has(file)?'official document body':documentAncestor(node);
  const item={file,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,start:node.getStart(ast),end:node.end,source:sourceText,rawSource:text,kind,...extra};
  (reason?preserved:sites).push(reason?{...item,reason}:item);
 };
 const output=(node)=>{
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)){add(node,node.text,'expression');return;}
  if(ts.isConditionalExpression(node)){output(node.whenTrue);output(node.whenFalse);return;}
  if(ts.isParenthesizedExpression(node)){output(node.expression);return;}
  if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)){output(node.right);return;}
  if(ts.isTemplateExpression(node)){
   let text=node.head.text;const values=[];
   for(const [index,span] of node.templateSpans.entries()){text+=`{arg${index}}`+span.literal.text;values.push(span.expression.getText(ast));}
   add(node,text,'template',{values});
  }
 };
 const visit=node=>{
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='translateInterfaceText'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))add(node.arguments[0],node.arguments[0].text,'localized');
  else if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='source'&&node.initializer&&ts.isStringLiteral(node.initializer)&&node.parent?.parent?.tagName?.getText(ast)==='InterfaceText')add(node.initializer,node.initializer.text,'localized');
  else if(ts.isPropertyAssignment(node)&&['label','title','subtitle','description'].includes(node.name.getText(ast))&&ts.isStringLiteral(node.initializer)){
   let binding=node.parent;while(binding&&!ts.isVariableDeclaration(binding))binding=binding.parent;
   const name=binding?.name.getText(ast)||'';
   if(/^(?:tabs|navItems|landingNavItems|pageLinks|menuItems|wizardSteps|settingsTabs|steps|TABS|NAV_ITEMS|MENU_ITEMS)$/.test(name))add(node,node.initializer.text,'property',{property:node.name.getText(ast)});
  }
  else if(ts.isJsxText(node))add(node,jsxText(node.text),'text',{start:node.pos});
  else if(ts.isJsxAttribute(node)&&outputAttributes.has(node.name.getText(ast))&&node.initializer){
   if(ts.isStringLiteral(node.initializer))add(node.initializer,decodeEntities(node.initializer.text),'attribute');
   else if(ts.isJsxExpression(node.initializer)&&node.initializer.expression)output(node.initializer.expression);
  }else if(ts.isJsxExpression(node)&&node.expression&&ts.isJsxElement(node.parent))output(node.expression);
  else if(ts.isCallExpression(node)&&node.arguments[0]&&/^(?:alert|confirm|toast\.(?:error|success|info|warning))$/.test(node.expression.getText(ast)))output(node.arguments[0]);
  else if(ts.isCallExpression(node)&&node.arguments[0]&&/^set\w*(?:Error|Warning|ErrorMessage|StatusMsg|SuccessMsg|Message)$/.test(node.expression.getText(ast))){const start=sites.length;output(node.arguments[0]);for(let index=start;index<sites.length;index++)sites[index].deferred=true;}
  ts.forEachChild(node,visit);
 };
 visit(ast);
 return {ast,sites:[...new Map(sites.map(site=>[site.start,site])).values()],preserved};
}
export function componentFiles(){const files=['src/App.tsx'];function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.tsx'))files.push(file);}}walk('src/components');return files;}
export function collectUi(){const sites=[],preserved=[];for(const file of componentFiles()){const result=inspectUi(file);sites.push(...result.sites);preserved.push(...result.preserved);}return {sites,preserved};}
