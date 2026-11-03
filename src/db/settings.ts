import { db } from './index.ts';
import { systemSettings } from './schema.ts';
import { eq, sql } from 'drizzle-orm';

export async function getSystemSetting<T = any>(key: string, defaultValue?: T): Promise<T | null> {
  try {
    // pg already decodes JSONB. Avoid Drizzle parsing JSON-looking string values twice.
    const rows = await db.select({ value: sql<T>`${systemSettings.value}` }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    if (rows.length > 0 && rows[0].value !== null) {
      return rows[0].value as T;
    }
    return defaultValue ?? null;
  } catch (err) {
    console.error(`Database query error in getSystemSetting(${key}):`, err);
    return defaultValue ?? null;
  }
}

export async function getStoredSystemSetting<T = any>(key: string): Promise<T | null> {
  // pg already decodes JSONB. Avoid Drizzle parsing JSON-looking string values twice.
  const rows = await db.select({ value: sql<T>`${systemSettings.value}` }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return rows.length > 0 ? rows[0].value as T | null : null;
}

export async function setSystemSetting<T = any>(key: string, value: T): Promise<T> {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('Setting values must be JSON serializable.');
    // Explicit JSONB encoding preserves JSON null, strings, booleans and arrays.
    const jsonValue = sql`${serialized}::jsonb`;
    await db
      .insert(systemSettings)
      .values({
        key,
        value: jsonValue,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: jsonValue,
          updatedAt: new Date(),
        },
      });
    return value;
  } catch (err) {
    console.error(`Database query error in setSystemSetting(${key}):`, err);
    throw new Error(`Failed to persist system setting for ${key}.`);
  }
}
