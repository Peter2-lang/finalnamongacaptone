import { randomUUID } from 'node:crypto';
import { db } from './index.ts';
import { users } from './schema.ts';
import { eq, or } from 'drizzle-orm';
import { UserAccount } from '../types.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mapDbToUser(row: any): UserAccount {
  const permissions = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions;
  const username = row.uid && !/^usr[-_]/i.test(String(row.uid))
    ? String(row.uid)
    : (row.email ? row.email.split('@')[0] : `user-${row.id}`);
  return {
    id: String(row.id || row.uid),
    username,
    name: row.name || 'User',
    email: row.email,
    role: (row.role || 'focal') as any,
    assignedBarangay: row.assignedBarangay || undefined,
    barangay_id: row.assignedBarangay ? `brgy-${row.assignedBarangay.toLowerCase().replace(/\s+/g, '-')}` : undefined,
    phone: row.phone || '',
    contactNo: row.phone || '',
    authUserId: row.authUserId || undefined,
    active: row.active ?? row.isActive ?? row.status === 'active',
    isActive: row.isActive ?? row.active ?? row.status === 'active',
    status: row.status || (row.active === false ? 'inactive' : 'active'),
    permissions: Array.isArray(permissions) ? permissions : [],
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
  };
}

export async function getAllUsers(): Promise<UserAccount[]> {
  const rows = await db.select().from(users);
  return rows.map(mapDbToUser);
}

export async function getUserByUsernameOrEmail(identifier: string): Promise<UserAccount | null> {
  const rows = await db
    .select()
    .from(users)
    .where(or(eq(users.email, identifier), eq(users.uid, identifier)))
    .limit(1);

  if (rows.length > 0) {
    return mapDbToUser(rows[0]);
  }
  if (UUID_REGEX.test(identifier)) {
    const idRows = await db.select().from(users).where(or(eq(users.id, identifier as any), eq(users.authUserId, identifier as any))).limit(1);
    if (idRows.length > 0) return mapDbToUser(idRows[0]);
  }
  // Also check if identifier matches prefix of email
  const all = await getAllUsers();
  return all.find(u => u.username === identifier || u.email.toLowerCase() === identifier.toLowerCase()) || null;
}

export async function getUserByAuthUserId(authUserId: string): Promise<UserAccount | null> {
  const rows = await db.select().from(users).where(eq(users.authUserId, authUserId)).limit(1);
  return rows[0] ? mapDbToUser(rows[0]) : null;
}

export async function upsertUser(user: Partial<UserAccount>): Promise<UserAccount> {
  try {
    const uid = (user as any).uid || user.username || (user.id && !UUID_REGEX.test(user.id) ? user.id : `usr-${Date.now()}`);
    const email = user.email || `${user.username || 'user'}@hinunangan.da.gov.ph`;
    
    // Ensure primary key id is ALWAYS a valid UUID
    let primaryId: string;
    if (user.authUserId && UUID_REGEX.test(user.authUserId)) {
      primaryId = user.authUserId;
    } else if (user.id && UUID_REGEX.test(user.id)) {
      primaryId = user.id;
    } else {
      primaryId = randomUUID();
    }

    const authUserId = user.authUserId && UUID_REGEX.test(user.authUserId) ? user.authUserId : null;

    const values = {
      id: primaryId,
      uid,
      email,
      name: user.name || user.fullName || user.username || 'User',
      role: user.role || 'focal',
      assignedBarangay: user.assignedBarangay || null,
      phone: user.phone || null,
      authUserId,
      active: user.active ?? true,
      isActive: user.isActive ?? user.active ?? true,
      status: user.status || (user.active === false ? 'inactive' : 'active'),
      permissions: user.permissions || [],
    };

    const result = await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({
        target: users.id,
        set: values,
      })
      .returning();

    return mapDbToUser(result[0]);
  } catch (err) {
    console.error('Database query failed for upsertUser:', err);
    throw new Error('Failed to save user account to database.');
  }
}

export async function insertUserProfile(user: Partial<UserAccount> & { uid: string }): Promise<UserAccount> {
  const authUserId = user.authUserId;
  if (!authUserId || !UUID_REGEX.test(authUserId)) {
    throw new Error('A valid Supabase Auth user ID is required to create an account profile.');
  }
  const values = {
    id: authUserId,
    uid: user.uid,
    email: user.email || '',
    name: user.name || user.fullName || user.username || 'User',
    role: user.role || 'focal',
    assignedBarangay: user.assignedBarangay || null,
    phone: user.phone || null,
    authUserId,
    active: user.active ?? true,
    isActive: user.isActive ?? user.active ?? true,
    status: user.status || (user.active === false ? 'inactive' : 'active'),
    permissions: user.permissions || [],
  };
  const inserted = await db.insert(users).values(values).returning();
  if (!inserted[0]) throw new Error('Database did not return the inserted user profile.');
  return mapDbToUser(inserted[0]);
}

export async function deleteUserByUid(uid: string): Promise<boolean> {
  try {
    if (UUID_REGEX.test(uid)) {
      await db.delete(users).where(or(eq(users.uid, uid), eq(users.id, uid as any), eq(users.authUserId, uid as any)));
    } else {
      await db.delete(users).where(eq(users.uid, uid));
    }
    return true;
  } catch (err) {
    console.error('Database error in deleteUserByUid:', err);
    throw new Error('Failed to delete user account from database.');
  }
}
