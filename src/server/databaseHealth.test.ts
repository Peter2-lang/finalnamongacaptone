import { successfulSchemaRows } from './testSupport/schemaFixture.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import { verifyDatabaseSchema, getSchemaProbeFailure } from './databaseHealth.ts';

test('audit health uses canonical names, not legacy aliases', async () => {
  const statements: string[] = [];
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: successfulSchemaRows(sql) }; } } as unknown as Pick<PoolClient, 'query'>;
  await verifyDatabaseSchema(client);
  const audit = statements.find(sql => sql.includes('public."audit_logs"'))!;
  assert.match(audit, /"table_name"/);
  assert.match(audit, /"created_at"/);
  assert.doesNotMatch(audit, /"entity"|"entity_id"|"timestamp"|"username"/);
  assert.ok(statements.some(sql => sql.includes('public."certificate_templates"')));
  assert.ok(statements.some(sql => sql.includes('public."legal_documents"')));
});

test('42703 captures the exact generated SELECT and only a known missing identifier', async () => {
  const client = { query: async (sql: string) => {
    if (sql.includes('public."issued_certificates"')) throw Object.assign(new Error('column "control_number" does not exist'), { code: '42703' });
    return { rows: successfulSchemaRows(sql) };
  } } as unknown as Pick<PoolClient, 'query'>;
  await assert.rejects(verifyDatabaseSchema(client), (error: any) => {
    assert.equal(error.code, '42703');
    const failure = getSchemaProbeFailure(error)!;
    assert.equal(failure.table, 'issued_certificates');
    assert.equal(failure.column, 'control_number');
    assert.match(failure.statement, /^SELECT .*"control_number".*FROM public\."issued_certificates" LIMIT 0$/);
    return true;
  });
});

test('schema identifiers are determined from PostgreSQL positions and qualified names', async () => {
  for (const style of ['position', 'qualified', 'unqualified']) {
    const client = { query: async (sql: string) => {
      if (!sql.includes('public."media_files"')) return { rows: successfulSchemaRows(sql) };
      const error = Object.assign(new Error(style === 'qualified' ? 'column media_files.file_url does not exist' : style === 'unqualified' ? 'column "file_url" does not exist' : 'private diagnostic text'), {
        code: '42703', ...(style === 'position' ? { position: String(sql.indexOf('"file_url"') + 1) } : {}),
      });
      throw error;
    } } as unknown as Pick<PoolClient, 'query'>;
    await assert.rejects(verifyDatabaseSchema(client), (error: unknown) => {
      assert.equal(getSchemaProbeFailure(error)?.column, 'file_url');
      return true;
    });
  }
});

test('missing migrated tag sequence is reported without creating it or consuming a value', async () => {
  const queries: string[]=[];
  const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.includes('to_regclass')?[{present:false,usable:false}]:successfulSchemaRows(sql)};}} as unknown as Pick<PoolClient,'query'>;
  await assert.rejects(verifyDatabaseSchema(client),(error:any)=>error.code==='SCHEMA_OBJECT_MISSING');
  assert.ok(queries.every(sql=>! /\b(?:CREATE|ALTER|DROP|nextval|setval)\b/i.test(sql)));
});
