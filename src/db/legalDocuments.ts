import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ASFRegulatoryDocument } from '../types.ts';

// Table DDL belongs to versioned SQL (migration 012 and reviewed proposals).

export function isLegalDocument(value: unknown): value is ASFRegulatoryDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<ASFRegulatoryDocument>;
  const validStatuses = new Set(['draft', 'for_verification', 'verified', 'active', 'superseded', 'amended', 'archived', 'repealed']);
  const validCompleteness = new Set(['complete', 'excerpt', 'metadata_only']);
  return 'id' in value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200 &&
    'title' in value && typeof value.title === 'string' && value.title.trim().length > 0 &&
    'officialNumber' in value && typeof value.officialNumber === 'string' &&
    'type' in value && typeof value.type === 'string' &&
    'articles' in value && Array.isArray(value.articles) &&
    (document.status === undefined || validStatuses.has(document.status)) &&
    (document.sourceCompleteness === undefined || validCompleteness.has(document.sourceCompleteness));
}

export function hasVerifiableSourceAttachment(document: ASFRegulatoryDocument): boolean {
  if (document.sourceCompleteness !== 'complete' && document.sourceCompleteness !== 'excerpt') return false;
  const attachment = document.sourceDocuments?.find(item => item.isCurrent === true);
  return Boolean(
    attachment?.storagePath &&
    !attachment.storagePath.includes('..') &&
    attachment.storagePath.startsWith(`legal-documents/${document.id}/`),
  );
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
      const versionHistory = old
        ? [
            ...(old.versionHistory || []),
            {
              version: (old.versionHistory || []).reduce((max, entry) => Math.max(max, Number(entry.version) || 0), 0) + 1,
              updatedAt: new Date().toISOString(),
              updatedBy: actor.username,
              changeSummary: `Updated by ${actor.role}`,
              documentSnapshot: Object.fromEntries(
                Object.entries(old).filter(([key]) => key !== 'auditLogs' && key !== 'versionHistory'),
              ),
            },
          ]
        : (document.versionHistory || []);
      const clean = { ...document, auditLogs: old?.auditLogs || [], versionHistory,
        importProvenance: document.importProvenance ? {
          ...document.importProvenance,
          reviewedBy: actor.userId,
          uploadedAt: old?.importProvenance?.uploadedAt || new Date().toISOString(),
        } : undefined,
      };
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
