import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import ts from 'typescript';

test('components and custom hooks do not skip hooks after early returns or inside branches',()=>{
 const failures:string[]=[];
 for(const file of readdirSync('src',{recursive:true}).map(String).filter(f=>/\.(tsx|ts)$/.test(f)&&!f.endsWith('.test.ts'))){
  const source=ts.createSourceFile(file,readFileSync(`src/${file}`,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  function visit(node:ts.Node){
   if(ts.isFunctionLike(node)&&'body' in node&&node.body&&ts.isBlock(node.body)){
    const body=node.body;
    let returned=false;
    function scan(child:ts.Node,conditional=false){
     if(child!==body&&ts.isFunctionLike(child))return;
     if(ts.isCallExpression(child)&&/^(React\.)?use[A-Z]/.test(child.expression.getText(source))&&(returned||conditional)){
      failures.push(`${file}:${source.getLineAndCharacterOfPosition(child.getStart(source)).line+1} ${child.expression.getText(source)}`);
     }
     const branch=conditional||ts.isIfStatement(child)||ts.isConditionalExpression(child)||ts.isIterationStatement(child,false)||ts.isSwitchStatement(child);
     ts.forEachChild(child,c=>scan(c,branch));
     if(ts.isReturnStatement(child))returned=true;
    }
    scan(body);
   }
   ts.forEachChild(node,visit);
  }
  visit(source);
 }
 assert.deepEqual(failures,[]);
});
