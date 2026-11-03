import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import { verifyDatabaseSchema, getSchemaProbeFailure } from './databaseHealth.ts';

test('audit health uses canonical names, not legacy aliases', async () => {
  const statements: string[] = [];
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: [] }; } } as unknown as Pick<PoolClient, 'query'>;
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
    return { rows: [] };
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
