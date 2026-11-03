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
