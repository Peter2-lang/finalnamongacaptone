import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getDatabaseDiagnostic } from './diagnostics.ts';
import { getDatabaseConnectionInfo, getDatabasePoolConfig } from './poolConfig.ts';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: any | undefined;
  var _isPgMem: boolean | undefined;
}

/** Build one pool per warm runtime. Invalid configuration is reported by health,
 * rather than throwing while Vercel imports the function. */
export const createPool = () => {
  if (global._postgresPool) return global._postgresPool;
  const config = getDatabasePoolConfig();
  global._postgresPool = new Pool(config);
  global._isPgMem = false;
  global._postgresPool.on('error', (error: any) => {
    console.error('[DATABASE] idle_connection_error', { ...getDatabaseDiagnostic(error), connection: getDatabaseConnectionInfo() });
  });
  return global._postgresPool;
};

// A stable Pool facade also keeps Drizzle attached to the current shared pool.
// No connection is opened (or localhost fallback attempted) during module import.
export const pool = new Proxy(Object.create(Pool.prototype) as Pool, {
  get(target, property, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, property)) return Reflect.get(target, property, receiver);
    if (property === 'connect' || property === 'query') {
      return (...args: any[]) => {
        const activePool = createPool();
        return activePool[property](...args);
      };
    }
    if (property === 'end') return async () => { if (global._postgresPool) await global._postgresPool.end(); };
    return Reflect.get(target, property, receiver);
  },
});

/**
 * Drizzle database instance.
 */
export const db = drizzle(pool, { schema });

/**
 * Dynamically switches the active database connection pool
 * without running schema changes.
 */
export async function updateDatabaseConnection(
  connectionString: string
): Promise<{ success: boolean; message: string }> {
  try {
    const cleanedConnectionString = connectionString?.trim();

    if (!cleanedConnectionString) {
      return {
        success: false,
        message: 'Database connection string is empty.',
      };
    }

    const testResult = await testDatabaseConnection(
      cleanedConnectionString
    );

    if (!testResult.success) {
      return {
        success: false,
        message: testResult.message,
      };
    }

    const newPool = new Pool(getDatabasePoolConfig({ ...process.env, DATABASE_URL: cleanedConnectionString }));

    // Close old PostgreSQL pool.
    if (global._postgresPool && !global._isPgMem) {
      try {
        await global._postgresPool.end();
      } catch {
        // Ignore old pool shutdown errors.
      }
    }

    global._postgresPool = newPool;
    global._isPgMem = false;

    process.env.DATABASE_URL = cleanedConnectionString;

    // Schema changes are a separate, reviewed deployment operation.

    return {
      success: true,
      message:
        'Switched to new PostgreSQL connection successfully!',
    };
  } catch (err: any) {
    return {
      success: false,
      message:
        err?.message ||
        'Failed to switch database pool',
    };
  }
}

/**
 * Test a PostgreSQL connection without replacing
 * the application's current pool.
 */
export async function testDatabaseConnection(
  connectionString: string
): Promise<{
  success: boolean;
  message: string;
  errorCode?: string;
  errorKind?: string;
}> {
  let testPool: Pool | null = null;

  try {
    const cleanedConnectionString =
      connectionString?.trim();

    if (!cleanedConnectionString) {
      return {
        success: false,
        message: 'Database connection string is empty.',
        errorKind: 'configuration',
      };
    }

    testPool = new Pool(getDatabasePoolConfig({ ...process.env, DATABASE_URL: cleanedConnectionString }));

    const client = await testPool.connect();

    try {
      await client.query('SELECT 1');

      return {
        success: true,
        message:
          'PostgreSQL database connection successful.',
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    const errorCode = err?.code || undefined;
    const message =
      err?.message ||
      'Unable to connect to PostgreSQL database.';

    let errorKind = 'unknown';

    if (
      errorCode === '28P01' ||
      errorCode === '28000'
    ) {
      errorKind = 'authentication';
    } else if (
      errorCode === 'ENOTFOUND' ||
      errorCode === 'EAI_AGAIN'
    ) {
      errorKind = 'dns';
    } else if (
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNREFUSED'
    ) {
      errorKind = 'network';
    } else if (
      message.toLowerCase().includes('password')
    ) {
      errorKind = 'authentication';
    } else if (
      message.toLowerCase().includes('timeout')
    ) {
      errorKind = 'timeout';
    }

    return {
      success: false,
      message,
      errorCode,
      errorKind,
    };
  } finally {
    if (testPool) {
      try {
        await testPool.end();
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

/**
 * No-op retained for backwards compatibility.
 * Local in-memory persistence is disabled; all data uses PostgreSQL.
 */
export async function persistLocalDatabase(): Promise<void> {}

/** Retained only to fail safely for old callers in every environment.
 * Schema creation, upgrades and seeds are reviewed SQL operations, never startup. */
export function initPostgresTables(): Promise<boolean> {
  return Promise.reject(Object.assign(new Error('Runtime schema initialization is disabled. Use reviewed versioned SQL migrations.'), { code: 'SCHEMA_INITIALIZATION_DISABLED' }));
}
