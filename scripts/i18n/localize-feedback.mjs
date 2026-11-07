import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import {componentFiles} from './ui-source.mjs';
let count=0;
for(const file of componentFiles()){
 const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,99,true,4),edits=[];
 const feedback=name=>/^(?:error|warning|successMessage|errorMessage|loadError|fileReadError|importStatusMsg|importSuccessMsg|resultStatus)$/.test(name)||/(?:Error|Warning|SuccessMsg)$/.test(name);
 function visit(node){
  if(ts.isJsxExpression(node)&&node.expression&&ts.isJsxElement(node.parent)){
   const expression=node.expression;
   let value=false;
   if(ts.isIdentifier(expression))value=feedback(expression.text);
   if(ts.isElementAccessExpression(expression)&&ts.isIdentifier(expression.expression))value=/errors$/i.test(expression.expression.text);
   if(value){edits.push({start:expression.getStart(ast),end:expression.end,text:`<LocalizedFeedback value={${expression.getText(ast)}} />`});}
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);if(!edits.length)continue;
 let next=source;for(const edit of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);
 let relative=path.relative(path.dirname(file),'src/i18n/LocalizedFeedback').replaceAll('\\','/');if(!relative.startsWith('.'))relative='./'+relative;
 if(!/import.*LocalizedFeedback.*from/.test(next))next=`import { LocalizedFeedback } from '${relative}';\n`+next;fs.writeFileSync(file,next);count+=edits.length;
}
console.log(JSON.stringify({feedbackBindings:count}));
