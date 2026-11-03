import { db } from './index.ts';
import { issuedCertificates } from './schema.ts';
import { eq, or } from 'drizzle-orm';

export function mapCertToDb(c: any) {
  return {
    id: c.id,
    controlNumber: c.controlNumber || c.certificateNumber || c.certificateNo || c.id,
    swineId: c.swineId || '',
    farmerName: c.farmerName || c.raiserName || '',
    barangay: c.barangay || c.farmerBarangay || c.issuingBarangay || '',
    issueDate: c.issueDate || new Date().toISOString(),
    purpose: c.purpose || c.certificateType || 'Transport / Slaughter Permit',
    destination: c.destination || '',
    inspectedBy: c.inspectedBy || c.issuedBy || 'Municipal Agriculturist',
    qrPayload: c.qrPayload || '',
    validUntil: c.validUntil || '',
    status: (c.status || 'VALID').toUpperCase(),
    metadata: c.metadata || c,
  };
}

export function mapDbToCert(row: any) {
  return {
    ...(row.metadata || {}),
    id: row.id,
    certificateNo: row.controlNumber,
    controlNumber: row.controlNumber,
    swineId: row.swineId || '',
    farmerName: row.farmerName,
    barangay: row.barangay,
    farmerBarangay: row.barangay,
    issuingBarangay: row.barangay,
    issueDate: row.issueDate,
    purpose: row.purpose,
    certificateType: row.purpose,
    destination: row.destination,
    inspectedBy: row.inspectedBy,
    qrPayload: row.qrPayload,
    validUntil: row.validUntil,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export async function getAllCertificates() {
  try {
    const certs = await db.select().from(issuedCertificates);
    return certs.map(mapDbToCert);
  } catch (error) {
    console.error('Database query failed for getAllCertificates:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getCertificateByIdOrControlNumber(idOrNumber: string) {
  try {
    const rows = await db
      .select()
      .from(issuedCertificates)
      .where(or(eq(issuedCertificates.id, idOrNumber), eq(issuedCertificates.controlNumber, idOrNumber)))
      .limit(1);
    return rows[0] ? mapDbToCert(rows[0]) : null;
  } catch (error) {
    console.error('Database query failed for getCertificateByIdOrControlNumber:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertCertificates(certs: any[]) {
  try {
    if (certs.length === 0) return [];
    const dbCerts = certs.map(mapCertToDb);
    const results = await db.insert(issuedCertificates).values(dbCerts).onConflictDoNothing().returning();
    return results.map(mapDbToCert);
  } catch (error) {
    console.error('Database query failed for insertCertificates:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function upsertCertificate(cert: any) {
  try {
    const dbCert = mapCertToDb(cert);
    const result = await db
      .insert(issuedCertificates)
      .values(dbCert)
      .onConflictDoUpdate({
        target: issuedCertificates.id,
        set: dbCert,
      })
      .returning();
    return mapDbToCert(result[0]);
  } catch (error) {
    console.error('Database query failed for upsertCertificate:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function archiveCertificateByControlNumber(controlNumber: string): Promise<boolean> {
  const result = await db
    .update(issuedCertificates)
    .set({ status: 'ARCHIVED' })
    .where(or(eq(issuedCertificates.controlNumber, controlNumber), eq(issuedCertificates.id, controlNumber)))
    .returning({ id: issuedCertificates.id });
  return result.length > 0;
}
