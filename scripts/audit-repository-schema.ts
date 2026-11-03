import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { getRequiredDatabaseColumns } from '../src/db/requirements.ts';
import { comparePostgresTypes } from '../src/db/catalog.ts';

// Immutable audit baseline from before runtime DDL removal. This parses source,
// never evaluates the old initializer or connects to a database.
const baseline = process.argv[2] || '2ed12d8f2ea6212bb95e00ee087f27921e9f3c4e';
let legacy: string;
try { legacy = execFileSync('git',['show',`${baseline}:src/db/index.ts`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}); } catch { throw new Error('Cannot read the requested schema-audit Git baseline. Use a full checkout with read-only subprocess access.'); }
type Column = { type:string; notNull:boolean; primaryKey:boolean; unique:boolean; declaration:string; source:string };
function columns(source:string, file:string, result=new Map<string,Column>()) {
  const declarations:Array<{name:string;body:string}> = [];
  const create = /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?([a-z_][a-z_0-9]*)\s*\(/gi;
  for (let match; (match=create.exec(source));) {
    let depth=1, quoted=false, start=create.lastIndex, item=start;
    const parts:string[]=[];
    for(let cursor=start;cursor<source.length;cursor++) {
      const ch=source[cursor];
      if(ch==="'") {if(quoted && source[cursor+1]==="'"){cursor++;continue;}quoted=!quoted;}
      if(quoted) continue;
      if(ch==='(')depth++;
      if(ch===')')depth--;
      if((ch===','&&depth===1)||depth===0){parts.push(source.slice(item,cursor).trim());item=cursor+1;}
      if(depth===0)break;
    }
    for(const body of parts) declarations.push({name:match[1],body});
  }
  for (const match of source.matchAll(/ALTER TABLE\s+(?:public\.)?([a-z_][a-z_0-9]*)\s+ADD COLUMN IF NOT EXISTS\s+([^;]+);/gi)) declarations.push({name:match[1],body:match[2].trim()});
  for(const {name,body:raw} of declarations) {
    const body=raw.replace(/--[^\n]*/g,'').trim();
    const match=body.match(/^([a-z_][a-z_0-9]*)\s+((?:double precision|character varying|timestamp(?:\s+(?:with|without) time zone)?|[a-z_][a-z_0-9]*)(?:\([^)]*\))?)/i);
    if(!match || /^(?:primary|unique|constraint|check|foreign)$/i.test(match[1]))continue;
    const key=`${name}.${match[1]}`;
    // IF NOT EXISTS does not repair an already declared column's type/default.
    if(!result.has(key))result.set(key,{type:match[2].toLowerCase(),notNull:/\bNOT NULL\b|\bPRIMARY KEY\b/i.test(body),primaryKey:/\bPRIMARY KEY\b/i.test(body),unique:/\bUNIQUE\b/i.test(body),declaration:body,source:file});
  }
  return result;
}
const initialized=columns(legacy,`${baseline}:src/db/index.ts`);
const migrated=new Map<string,Column>();
const migrations=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')).sort();
for(const file of migrations)columns(readFileSync(`supabase/migrations/${file}`,'utf8'),file,migrated);
const rows=getRequiredDatabaseColumns().map(runtime=>{
 const key=`${runtime.table}.${runtime.column}`;
 const old=initialized.get(key), migration=migrated.get(key);
 const compare=(candidate:Column|undefined)=>candidate?{
   type:comparePostgresTypes(runtime.sqlType,candidate.type==='serial'?'integer':candidate.type),
   nullabilityReview:runtime.expectedNotNull===undefined?undefined:runtime.expectedNotNull!==candidate.notNull,
   primaryKeyReview:runtime.expectedPrimaryKey===undefined?undefined:runtime.expectedPrimaryKey!==candidate.primaryKey,
 }: {type:'not_declared'};
 return {runtime,legacyInitializer:old,migrationDeclaration:migration,legacyReview:compare(old),migrationReview:compare(migration)};
});
writeFileSync('docs/repository-schema-comparison.json',JSON.stringify({baseline,scope:'Static declaration comparison only. Conditional ALTER/UPDATE/RLS/trigger effects and production data must be inspected separately; this is not a live catalog or an executable migration.',migrations,legacyDeclarations:Array.from(initialized,([name,declaration])=>({name,...declaration})),historicalDeclarations:Array.from(migrated,([name,declaration])=>({name,...declaration})),columns:rows},null,2)+'\n');
console.log(`Audited ${rows.length} required column declarations without database access.`);
