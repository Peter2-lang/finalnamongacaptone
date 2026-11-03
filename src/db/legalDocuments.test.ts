import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { isLegalDocument, mutateLegalDocument } from './legalDocuments.ts';
import { ALL_ASF_REGULATIONS } from '../data/asfRegulationsData.ts';

test('legal writes commit document and verified actor audit together', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  let released = false;
  const mock = { connect: async () => ({
    query: async (sql: string, values: unknown[] = []) => { queries.push({ sql, values }); return { rows: [] }; },
    release: () => { released = true; },
  }) } as unknown as Pool;
  const doc = ALL_ASF_REGULATIONS[0];
  assert.equal(await mutateLegalDocument(mock, 'create', doc.id, doc, { userId: 'verified-id', username: 'Verified Admin', role: 'admin' }), true);
  const audit = queries.find(query => query.sql.includes('INSERT INTO legal_document_audit_logs'));
  assert.deepEqual(audit?.values.slice(4, 7), ['verified-id', 'Verified Admin', 'admin']);
  assert.equal(queries.at(-1)?.sql, 'COMMIT');
  assert.equal(released, true);
});

test('failed audit insert rolls back the document and releases connection', async () => {
  const statements: string[] = [];
  let released = false;
  const mock = { connect: async () => ({
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('INSERT INTO legal_document_audit_logs')) throw new Error('audit write failed');
      return { rows: [] };
    }, release: () => { released = true; },
  }) } as unknown as Pool;
  const doc = ALL_ASF_REGULATIONS[0];
  await assert.rejects(mutateLegalDocument(mock, 'create', doc.id, doc, { userId: 'actor', username: 'Admin', role: 'admin' }), /audit write failed/);
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(released, true);
});

test('missing documents produce no audit writes', async () => {
  const statements: string[] = [];
  const mock = { connect: async () => ({
    query: async (sql: string) => { statements.push(sql); return { rows: [] }; }, release: () => {},
  }) } as unknown as Pool;
  assert.equal(await mutateLegalDocument(mock, 'delete', 'missing', undefined, { userId: 'actor', username: 'Admin', role: 'admin' }), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(statements.some(sql => sql.includes('INSERT')), false);
});

test('legal document validation rejects malformed input', () => {
  assert.equal(isLegalDocument(null), false);
  assert.equal(isLegalDocument({ id: 'id', title: '', officialNumber: '1', type: 'ordinance', articles: [] }), false);
  assert.equal(isLegalDocument(ALL_ASF_REGULATIONS[0]), true);
});
