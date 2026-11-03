// ISOLATED TEST FIXTURE ONLY. Not a production migration or approved baseline.
import { getRequiredDatabaseColumns, getRequiredDatabaseTables } from '../src/db/requirements.ts';
import { REQUIRED_CONFLICT_KEYS, REQUIRED_GENERATED_IDS } from '../src/db/writeRequirements.ts';
const q=(value:string)=>'"'+value.replaceAll('"','""')+'"';
console.log('BEGIN;');
for(const [table] of getRequiredDatabaseTables()) {
 const columns=getRequiredDatabaseColumns().filter(item=>item.table===table);
 console.log(`CREATE TABLE public.${q(table)} (${columns.map(item=>`${q(item.column)} ${item.sqlType}${REQUIRED_GENERATED_IDS.some(([t,c])=>t===table&&c===item.column)?' DEFAULT gen_random_uuid()':''}`).join(',')});`);
}
for(const [table,column] of REQUIRED_CONFLICT_KEYS)console.log(`ALTER TABLE public.${q(table)} ADD UNIQUE (${q(column)});`);
console.log('CREATE SEQUENCE public.swine_tag_seq; COMMIT;');
