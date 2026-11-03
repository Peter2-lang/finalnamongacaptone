import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

test('SQL Editor preparation is offline, ordered, role-bound and atomically receipted',()=>{
 const dir=mkdtempSync(join(tmpdir(),'swine-review-bundle-'));
 try {
  execFileSync(process.execPath,['--import','tsx','scripts/prepare-sql-editor-bundle.ts','--backend-role','registry_review_backend','--out-dir',dir],{stdio:'pipe',env:{PATH:process.env.PATH}});
  const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
  assert.equal(manifest.status,'REVIEW_REQUIRED_NOT_APPLIED');
  assert.deepEqual(manifest.migrations.map((item:any)=>item.version),['202611030000','202611030001','202611030002','202611030003','202611030004','202611030005','202611040006']);
  for(const item of manifest.migrations) {
   const sql=readFileSync(join(dir,item.file),'utf8');
   const payload=readFileSync(item.source,'utf8').replace("'REPLACE_WITH_VERIFIED_BACKEND_ROLE'","'registry_review_backend'");
   assert.equal(hash(sql),item.fileSha256);
   assert.equal(hash(payload),item.payloadSha256);
   assert.match(sql,/INSERT INTO registry_migrations\.applied_migrations/);
   assert.match(sql,/ON CONFLICT\(version\) DO NOTHING/);
   assert.ok(sql.indexOf('INSERT INTO registry_migrations.applied_migrations')<sql.lastIndexOf('COMMIT;'));
   assert.doesNotMatch(sql,/\b(?:TRUNCATE|DROP TABLE|ALTER COLUMN .* TYPE)\b/i);
  }
  assert.equal(manifest.productionCatalogVerified,false);
  for(const item of manifest.checks)assert.equal(hash(readFileSync(join(dir,item.file),'utf8')),item.fileSha256);
  const biosecurity=readFileSync(join(dir,manifest.migrations.find((item:any)=>item.version==='202611030005').file),'utf8');
  assert.match(biosecurity,/ADD COLUMN IF NOT EXISTS biosecurity_warning boolean/);
  assert.doesNotMatch(biosecurity,/biosecurity_warning boolean\s+(?:NOT NULL|DEFAULT)/i);
  const users=readFileSync(join(dir,manifest.migrations.find((item:any)=>item.version==='202611040006').file),'utf8');
  assert.match(users,/ADD COLUMN IF NOT EXISTS permissions JSONB/);
  assert.match(users,/ADD COLUMN IF NOT EXISTS phone TEXT/);
  assert.match(users,/ADD COLUMN IF NOT EXISTS status TEXT/);
  assert.doesNotMatch(users,/UPDATE public\.users|ALTER COLUMN .* TYPE/i);
  const preflight=readFileSync(join(dir,'checks/00_preflight.sql'),'utf8');
  assert.match(preflight,/BEGIN TRANSACTION READ ONLY/);
  assert.match(preflight,/registry_review.expected_database',''/);
  const verification=readFileSync(join(dir,'checks/07_verify_schema.sql'),'utf8');
  assert.match(verification,/Write contract blocked/);
  assert.match(verification,/indimmediate/);
  assert.doesNotMatch(verification,/\b(?:INSERT INTO|UPDATE public|CREATE TABLE|nextval\()\b/i);
  const policy=readFileSync(join(dir,manifest.migrations.find((item:any)=>item.version==='202611030004').file),'utf8');
  assert.match(policy,/set_config\('registry_migration.backend_role','registry_review_backend'/);
  assert.match(policy,/pg_has_role/);
  assert.match(policy,/obj_description/);
  assert.doesNotMatch(policy,/GRANT .* TO PUBLIC/i);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('browser roles and injected role arguments cannot prepare a deployment bundle',()=>{
 for(const role of ['anon','authenticated','authenticator',"bad'; GRANT ALL TO PUBLIC; --"]){
  assert.throws(()=>execFileSync(process.execPath,['--import','tsx','scripts/prepare-sql-editor-bundle.ts','--backend-role',role],{stdio:'pipe',env:{PATH:process.env.PATH}}));
 }
});
