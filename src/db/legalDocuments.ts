import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ASFRegulatoryDocument } from '../types.ts';

export const LEGAL_DOCUMENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS legal_documents (
  id text PRIMARY KEY,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS legal_document_audit_logs (
  id uuid PRIMARY KEY,
  document_id text NOT NULL,
  document_title text NOT NULL,
  action text NOT NULL CHECK (action IN ('create','update','archive','restore','delete','import')),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  details text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_document_audit_document_idx ON legal_document_audit_logs(document_id, created_at DESC);
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_document_audit_logs ENABLE ROW LEVEL SECURITY;
`;

export function isLegalDocument(value: unknown): value is ASFRegulatoryDocument {
  if (!value || typeof value !== 'object') return false;
  return 'id' in value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200 &&
    'title' in value && typeof value.title === 'string' && value.title.trim().length > 0 &&
    'officialNumber' in value && typeof value.officialNumber === 'string' &&
    'type' in value && typeof value.type === 'string' &&
    'articles' in value && Array.isArray(value.articles);
}

export async function mutateLegalDocument(
  pool: Pool, operation: 'create' | 'update' | 'delete', id: string,
  document: ASFRegulatoryDocument | undefined,
  actor: { userId: string; username: string; role: string },
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query<{ document: ASFRegulatoryDocument }>('SELECT document FROM legal_documents WHERE id = $1 FOR UPDATE', [id]);
    const old = previous.rows[0]?.document;
    if (operation !== 'create' && !old) { await client.query('ROLLBACK'); return false; }
    let action: string = operation;
    if (operation === 'delete') {
      await client.query('DELETE FROM legal_documents WHERE id = $1', [id]);
    } else if (document) {
      // Audit identity is never taken from client-provided document history.
      const clean = { ...document, auditLogs: old?.auditLogs || [] };
      if (operation === 'create') {
        await client.query('INSERT INTO legal_documents (id, document) VALUES ($1, $2)', [id, JSON.stringify(clean)]);
      } else {
        await client.query('UPDATE legal_documents SET document = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(clean)]);
        if (document.isArchived || document.status === 'archived') action = 'archive';
        else if (old?.isArchived || old?.status === 'archived') action = 'restore';
      }
    }
    await client.query(`INSERT INTO legal_document_audit_logs
      (id, document_id, document_title, action, actor_id, actor_name, actor_role, details)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), id, document?.title || old?.title || id, action, actor.userId, actor.username, actor.role, `${action} legal document`]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
