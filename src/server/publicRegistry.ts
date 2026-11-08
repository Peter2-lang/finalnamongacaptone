import { pool } from '../db/index.ts';
import { normalizeBiosecurityAudits } from './biosecurityValidation.ts';

// One SQL statement gives counts and assessment settings from the same committed snapshot.
export const PUBLIC_REGISTRY_SQL = `SELECT
 (SELECT count(DISTINCT id)::int FROM farmers WHERE is_active = TRUE AND is_archived = FALSE) AS farmers,
 (SELECT coalesce(json_agg(t), '[]'::json) FROM (
   SELECT b.id, b.name, b.code,
     to_jsonb(b)->>'latitude' AS latitude, to_jsonb(b)->>'longitude' AS longitude,
     CASE WHEN coalesce(to_jsonb(b)->'metadata'->>'publishFocalPersonName', 'false') = 'true' THEN (SELECT string_agg(u.name, ', ' ORDER BY u.name) FROM users u
       WHERE lower(trim(u.assigned_barangay)) = lower(trim(b.name)) AND u.role = 'focal'
         AND u.active = TRUE AND u.is_active = TRUE AND u.status = 'active') END AS "focalPersonName",
     EXISTS (SELECT 1 FROM users u WHERE lower(trim(u.assigned_barangay)) = lower(trim(b.name))
       AND u.role = 'focal' AND u.active = TRUE AND u.is_active = TRUE AND u.status = 'active') AS "focalPersonAssigned",
     count(s.id)::int AS "swineCount",
     count(s.id) FILTER (WHERE s.ready_to_sell = TRUE)::int AS "readyToSellCount"
   FROM barangays b LEFT JOIN swine_records s ON s.barangay_id = b.id
     AND s.is_archived = FALSE AND coalesce(to_jsonb(s)->>'is_active', 'true') = 'true' AND lower(s.status) NOT IN ('sold', 'deceased')
   GROUP BY b.id, b.name, b.code, to_jsonb(b) ORDER BY b.name
 ) t) AS barangays,
 (SELECT setting_value FROM system_settings WHERE setting_key = 'biosecurity_audits') AS audits`;

export function publicRegistrySummary(row: any) {
  if (!row || !Array.isArray(row.barangays) || !Number.isSafeInteger(Number(row.farmers)) || Number(row.farmers) < 0) throw new Error('Invalid public aggregate result.');
  if (row.audits != null && !Array.isArray(row.audits)) throw new Error('Invalid stored assessment data.');
  const audits = row.audits || [];
  const ids = new Set<string>();
  const barangays = row.barangays.map((b: any) => {
    if (!b || typeof b.id !== 'string' || !b.id || ids.has(b.id) || typeof b.name !== 'string' || !b.name.trim() || !['swineCount','readyToSellCount'].every(key => typeof b[key] === 'number' && Number.isSafeInteger(b[key]) && b[key] >= 0) || Number(b.readyToSellCount) > Number(b.swineCount)) throw new Error('Invalid barangay aggregate result.');
    ids.add(b.id);
    const approved = audits.filter((a: any) => a.reviewStatus === 'approved' && !a.isArchived &&
      (a.barangayId ? a.barangayId === b.id : a.barangay?.trim().toLowerCase() === b.name.trim().toLowerCase()))
      .sort((a: any, c: any) => String(c.auditDate).localeCompare(String(a.auditDate)) || String(c.id).localeCompare(String(a.id)));
    let audit: any;
    try { if (approved[0] && Number.isFinite(Date.parse(approved[0].auditDate))) audit = normalizeBiosecurityAudits([approved[0]])[0]; } catch { /* Invalid assessment is not verified data. */ }
    return { id: b.id, name: b.name, code: b.code, focalPersonName: b.focalPersonName || null, focalPersonAssigned: b.focalPersonAssigned === true, latitude: b.latitude != null && Number.isFinite(Number(b.latitude)) ? Number(b.latitude) : null, longitude: b.longitude != null && Number.isFinite(Number(b.longitude)) ? Number(b.longitude) : null, swineCount: Number(b.swineCount), readyToSellCount: Number(b.readyToSellCount),
      riskLevel: audit?.asfZone ?? null, classification: audit?.status ?? null, lastAssessmentDate: audit?.auditDate ?? null };
  });
  const assessed = barangays.filter((b: any) => b.classification);
  return { coveredBarangays: barangays.length, registeredFarmers: Number(row.farmers),
    activeSwine: barangays.reduce((n: number,b: any) => n+b.swineCount,0),
    readyToSell: barangays.reduce((n: number,b: any) => n+b.readyToSellCount,0),
    assessedBarangays: assessed.length, compliancePercent: assessed.length ? Math.round(assessed.filter((b: any) => b.classification === 'compliant').length / assessed.length * 1000)/10 : null, barangays };
}
export async function loadPublicRegistrySummary() {
  const result = await pool.query(PUBLIC_REGISTRY_SQL);
  return publicRegistrySummary(result.rows[0]);
}
