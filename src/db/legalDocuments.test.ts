import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { hasVerifiableSourceAttachment, isLegalDocument, mutateLegalDocument } from './legalDocuments.ts';
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

test('legal updates preserve the prior source as an immutable version snapshot', async () => {
  const original = { ...ALL_ASF_REGULATIONS[0], versionHistory: [], auditLogs: [] };
  let savedDocument: Record<string, unknown> | undefined;
  const mock = { connect: async () => ({
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT document FROM legal_documents')) return { rows: [{ document: original }] };
      if (sql.includes('UPDATE legal_documents SET document')) savedDocument = JSON.parse(String(values[1]));
      return { rows: [] };
    },
    release: () => {},
  }) } as unknown as Pool;
  const updated = { ...original, title: `${original.title} (updated)` };
  assert.equal(await mutateLegalDocument(mock, 'update', original.id, updated, {
    userId: 'verified-id', username: 'Verified Admin', role: 'admin',
  }), true);
  const versions = savedDocument?.versionHistory as Array<{ version: number; documentSnapshot: Record<string, unknown> }>;
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].documentSnapshot.title, original.title);
  assert.equal(versions[0].documentSnapshot.auditLogs, undefined);
});

test('legal document validation rejects malformed input', () => {
  assert.equal(isLegalDocument(null), false);
  assert.equal(isLegalDocument({ id: 'id', title: '', officialNumber: '1', type: 'ordinance', articles: [] }), false);
  assert.equal(isLegalDocument({ ...ALL_ASF_REGULATIONS[0], status: 'unverified' }), false);
  assert.equal(isLegalDocument(ALL_ASF_REGULATIONS[0]), true);
});

test('verification requires an uploaded current source and explicit completeness status', () => {
  const document = ALL_ASF_REGULATIONS[0];
  assert.equal(hasVerifiableSourceAttachment(document), false);
  assert.equal(hasVerifiableSourceAttachment({
    ...document,
    status: 'verified',
    sourceCompleteness: 'metadata_only',
    sourceDocuments: [{
      id: 'source-1',
      name: 'ordinance.pdf',
      url: '',
      storagePath: `legal-documents/${document.id}/v1-ordinance.pdf`,
      uploadedAt: new Date().toISOString(),
      isCurrent: true,
    }],
  }), false);
  assert.equal(hasVerifiableSourceAttachment({
    ...document,
    status: 'verified',
    sourceCompleteness: 'excerpt',
    sourceDocuments: [{
      id: 'source-1',
      name: 'ordinance-pages.pdf',
      url: '',
      storagePath: `legal-documents/${document.id}/v1-ordinance.pdf`,
      uploadedAt: new Date().toISOString(),
      isCurrent: true,
      version: 1,
    }],
  }), true);
});

test('import audit attribution comes from the authenticated server actor', async () => {
  let stored: any;
  const mock = { connect: async () => ({
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('INSERT INTO legal_documents')) stored = JSON.parse(String(values[1]));
      return { rows: [] };
    }, release: () => {},
  }) } as unknown as Pool;
  const doc = { ...ALL_ASF_REGULATIONS[0], importProvenance: {
    batchId: 'batch-fixture', sourceFileName: 'source.docx', uploadedAt: '1900-01-01', reviewedBy: 'spoofed', method: 'native XML', warnings: [], pages: [{ pageNumber: 1, text: 'WHEREAS original source text.' }],
  } };
  await mutateLegalDocument(mock, 'create', doc.id, doc, { userId: 'authenticated-user', username: 'Admin', role: 'admin' });
  assert.equal(stored.importProvenance.reviewedBy, 'authenticated-user');
  assert.notEqual(stored.importProvenance.uploadedAt, '1900-01-01');
  assert.equal(stored.importProvenance.pages[0].text, 'WHEREAS original source text.');
});
