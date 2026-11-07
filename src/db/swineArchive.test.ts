import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pool } from './index.ts';
import { permanentlyDeleteArchivedSwineRecord, setSwineArchiveStatus, SwinePermanentDeleteError } from './swine.ts';

const recordId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';
const archivedRecord = {
  id: recordId,
  barangay_id: '00000000-0000-4000-8000-000000000003',
  is_archived: true,
  old_data: { id: recordId, pig_id_tag: 'HIN-2026-0001', farmer_name: 'Fixture Farmer' },
};

function installPoolClient(
  handler: (sql: string, values?: unknown[]) => Promise<{ rows?: unknown[]; rowCount?: number }> | { rows?: unknown[]; rowCount?: number },
) {
  const originalConnect = pool.connect;
  const queries: string[] = [];
  (pool as any).connect = async () => ({
    release() {},
    query: async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      return handler(sql, values);
    },
  });
  return {
    queries,
    restore: () => { pool.connect = originalConnect; },
  };
}

test('archive status changes update only the archive flag', async () => {
  const originalQuery = pool.query;
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  pool.query = (async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    return { rows: [] };
  }) as typeof pool.query;
  try {
    await setSwineArchiveStatus(recordId, true);
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /SET is_archived = \$1 WHERE id = \$2::uuid RETURNING \*/);
    assert.deepEqual(queries[0].values, [true, recordId]);
  } finally {
    pool.query = originalQuery;
  }
});

test('permanent deletion audits atomically and preserves original record data', async () => {
  const fixture = installPoolClient(sql => {
    if (sql.includes('SELECT sr.id')) return { rows: [archivedRecord] };
    if (sql.includes('pg_constraint')) return { rows: [] };
    if (sql.includes('information_schema.columns')) return { rows: [] };
    if (sql.startsWith('DELETE FROM public.swine_records')) return { rowCount: 1 };
    return { rowCount: 1 };
  });
  try {
    await permanentlyDeleteArchivedSwineRecord(recordId, actorId);
    const auditIndex = fixture.queries.findIndex(sql => sql.includes('INSERT INTO public.audit_logs'));
    const deleteIndex = fixture.queries.findIndex(sql => sql.startsWith('DELETE FROM public.swine_records'));
    assert.ok(auditIndex > -1);
    assert.ok(deleteIndex > auditIndex);
    assert.equal(fixture.queries.at(-1), 'COMMIT');
  } finally {
    fixture.restore();
  }
});

test('permanent deletion refuses an active record without writing an audit or deleting', async () => {
  const fixture = installPoolClient(sql => ({
    rows: sql.includes('SELECT sr.id') ? [{ ...archivedRecord, is_archived: false }] : [],
  }));
  try {
    await assert.rejects(
      permanentlyDeleteArchivedSwineRecord(recordId, actorId),
      (error: unknown) => error instanceof SwinePermanentDeleteError && error.status === 409,
    );
    assert.ok(fixture.queries.includes('ROLLBACK'));
    assert.equal(fixture.queries.some(sql => sql.includes('INSERT INTO public.audit_logs')), false);
    assert.equal(fixture.queries.some(sql => sql.startsWith('DELETE FROM public.swine_records')), false);
  } finally {
    fixture.restore();
  }
});

test('permanent deletion preserves records that still reference the archived swine', async () => {
  const fixture = installPoolClient(sql => {
    if (sql.includes('SELECT sr.id')) return { rows: [archivedRecord] };
    if (sql.includes('pg_constraint')) {
      return { rows: [{ table_schema: 'public', table_name: 'certificates', column_name: 'swine_id' }] };
    }
    if (sql.includes('information_schema.columns')) return { rows: [] };
    if (sql.startsWith('SELECT 1 FROM "public"."certificates"')) return { rowCount: 1, rows: [{}] };
    return { rowCount: 1 };
  });
  try {
    await assert.rejects(
      permanentlyDeleteArchivedSwineRecord(recordId, actorId),
      (error: unknown) => error instanceof SwinePermanentDeleteError && error.status === 409,
    );
    assert.ok(fixture.queries.includes('ROLLBACK'));
    assert.equal(fixture.queries.some(sql => sql.includes('INSERT INTO public.audit_logs')), false);
    assert.equal(fixture.queries.some(sql => sql.startsWith('DELETE FROM public.swine_records')), false);
  } finally {
    fixture.restore();
  }
});
