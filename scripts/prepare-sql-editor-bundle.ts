import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const roleIndex=process.argv.indexOf('--backend-role');
const role=roleIndex<0?'':process.argv[roleIndex+1];
if(!role || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(role) || ['anon','authenticated','authenticator','PUBLIC'].includes(role) || role.startsWith('pg_')) {
  throw new Error('Supply --backend-role with the verified PostgreSQL server role name, never a password or pooler username suffix. Browser roles are refused.');
}
const outputIndex=process.argv.indexOf('--out-dir');
const output=resolve(outputIndex<0?'build/sql-editor-review':process.argv[outputIndex+1]);
mkdirSync(output,{recursive:true});
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const files=readdirSync('supabase/review').filter(file=>/^\d{12}_.*\.sql$/.test(file)).sort();
const manifest=[];
for(const file of files) {
  const source=readFileSync(`supabase/review/${file}`,'utf8');
  const payload=source.replace("'REPLACE_WITH_VERIFIED_BACKEND_ROLE'",`'${role}'`);
  const version=file.split('_')[0];
  const payloadHash=hash(payload);
  if(!/COMMIT;\s*$/.test(payload))throw new Error('Review file must end with a transaction commit.');
  const description=file.slice(version.length+1,-4).replaceAll("'","''");
  const receipt=`
-- Atomic receipt: hash covers the approved payload before this generated block.
DO $receipt$
BEGIN
 IF EXISTS(SELECT 1 FROM registry_migrations.applied_migrations WHERE version='${version}' AND sha256<>'${payloadHash}') THEN
  RAISE EXCEPTION 'Migration ${version} already has another checksum; no history is overwritten.';
 END IF;
END $receipt$;
INSERT INTO registry_migrations.applied_migrations(version,sha256,description)
VALUES('${version}','${payloadHash}','${description}') ON CONFLICT(version) DO NOTHING;
COMMIT;
`;
  const sql=payload.replace(/COMMIT;\s*$/,receipt);
  writeFileSync(resolve(output,file),sql);
  manifest.push({version,file,source:`supabase/review/${file}`,payloadSha256:payloadHash,fileSha256:hash(sql)});
}
writeFileSync(resolve(output,'manifest.json'),JSON.stringify({status:'REVIEW_REQUIRED_NOT_APPLIED',backendRole:role,migrations:manifest},null,2)+'\n');
console.log(`Prepared ${manifest.length} ordered SQL Editor files in ${output}. No database was contacted or changed.`);

// Read-only review gates are deliberately outside the canonical *.sql glob.
// They have no migration receipts and do not invent Supabase/Drizzle history.
const option=(name:string)=>{const index=process.argv.indexOf(name);return index<0?'':process.argv[index+1]||'';};
const databaseName=option('--database-name');
const backupReference=option('--backup-reference');
const sqlLiteral=(value:string)=>"'"+value.replaceAll("'","''")+"'";
const checks=resolve(output,'checks');
mkdirSync(checks,{recursive:true});
const settings=[['backend_role',role],['expected_database',databaseName],['backup_reference',backupReference]]
 .map(([key,value])=>`SELECT set_config('registry_review.${key}',${sqlLiteral(value)},true);`).join('\n');
const preflight=readFileSync('supabase/diagnostics/00_preflight.sql','utf8')
 .replace('BEGIN TRANSACTION READ ONLY;',`BEGIN TRANSACTION READ ONLY;\n${settings}`);
writeFileSync(resolve(checks,'00_preflight.sql'),preflight);
const verification=readFileSync('supabase/diagnostics/07_verify_schema.sql','utf8');
writeFileSync(resolve(checks,'07_verify_schema.sql'),verification);
const noWrites=(description:string)=>`-- ${description}\nBEGIN TRANSACTION READ ONLY;\nSELECT ${sqlLiteral(description)} AS review_status;\nCOMMIT;\n`;
writeFileSync(resolve(checks,'03_constraints_indexes.sql'),noWrites('BLOCKED: existing constraints and indexes require live catalog review; no constraint changes approved. New-table primary keys are in canonical stage 001.'));
writeFileSync(resolve(checks,'04_relationship_repairs.sql'),noWrites('NO REPAIRS AUTHORIZED: preserve all existing IDs, FKs and associations.'));
writeFileSync(resolve(checks,'06_seed_data.sql'),noWrites('NO SEEDS AUTHORIZED: no reference data or accounts will be inserted.'));
writeFileSync(resolve(checks,'review_bundle.sql'),[
 preflight,
 ...manifest.map(item=>`-- Canonical migration ${item.version}\n`+readFileSync(resolve(output,item.file),'utf8')),
 verification,
].join('\n'));
writeFileSync(resolve(output,'README.txt'),`REVIEW REQUIRED; NOTHING APPLIED.\nRun checks/00_preflight.sql first after catalog/backup/role review.\nThen execute canonical timestamped SQL files in manifest order, then checks/07_verify_schema.sql.\nchecks/review_bundle.sql is the same ordered SQL in one copy-paste file; choose one method, never both as different histories.\nPreflight fails unless --database-name and --backup-reference were supplied; these are operator attestations, not automatic validation of a backup.\nExisting constraints, relationships and optional seeds remain blocked/no-op. Full production catalog review and API functional tests are still required.\n`);

const checkFiles=readdirSync(checks).filter(file=>file.endsWith('.sql')).sort();
writeFileSync(resolve(output,'manifest.json'),JSON.stringify({
 status:'REVIEW_REQUIRED_NOT_APPLIED',productionCatalogVerified:false,backendRole:role,
 operatorAttestationsProvided:Boolean(databaseName&&backupReference),migrations:manifest,
 checks:checkFiles.map(file=>({file:`checks/${file}`,fileSha256:hash(readFileSync(resolve(checks,file),'utf8'))})),
},null,2)+'\n');
