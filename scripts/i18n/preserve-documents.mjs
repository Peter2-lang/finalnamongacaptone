import ts from 'typescript';
import fs from 'node:fs';
import {componentFiles,inspectUi} from './ui-source.mjs';
let restored=0;
for(const file of componentFiles()){
 const source=fs.readFileSync(file,'utf8'),{ast,preserved}=inspectUi(file,source),positions=new Set(preserved.filter(site=>site.kind==='localized').map(site=>site.start)),edits=[];
 const visit=node=>{
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='InterfaceText'){
   const attr=node.attributes.properties.find(item=>ts.isJsxAttribute(item)&&item.name.getText(ast)==='source');
   if(attr?.initializer&&ts.isStringLiteral(attr.initializer)&&positions.has(attr.initializer.getStart(ast)))edits.push({start:node.getStart(ast),end:node.end,text:`{${JSON.stringify(attr.initializer.text)}}`});
  }else if(ts.isCallExpression(node)&&node.expression.getText(ast)==='translateInterfaceText'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&positions.has(node.arguments[0].getStart(ast)))edits.push({start:node.getStart(ast),end:node.end,text:JSON.stringify(node.arguments[0].text)});
  ts.forEachChild(node,visit);
 };
 visit(ast);if(!edits.length)continue;
 let next=source;for(const edit of edits.sort((a,b)=>b.start-a.start)){next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);restored++;}
 fs.writeFileSync(file,next);
}
console.log(JSON.stringify({preservedDocumentLiterals:restored}));
