import '../src/server/env.ts';
import { Pool } from 'pg';
import type { TLSSocket } from 'node:tls';
import { getDatabaseConnectionInfo, getDatabasePoolConfig } from '../src/db/poolConfig.ts';
import { getDatabaseDiagnostic } from '../src/db/diagnostics.ts';

// Read-only diagnostic: real PostgreSQL connection and SELECT 1, no schema writes.
let pool: Pool | undefined;
try {
  const config = getDatabasePoolConfig();
  pool = new Pool(config);
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    const stream = (client as any).connection.stream as TLSSocket;
    if (config.ssl && stream.authorized !== true) throw Object.assign(new Error('TLS peer is not authorized.'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    console.log(JSON.stringify({ database: 'connected', tlsVerified: stream.authorized === true, ...getDatabaseConnectionInfo() }));
  } finally { client.release(); }
} catch (error) {
  console.error(JSON.stringify({ database: 'error', ...getDatabaseDiagnostic(error), connection: getDatabaseConnectionInfo() }));
  process.exitCode = 1;
} finally { await pool?.end(); }
