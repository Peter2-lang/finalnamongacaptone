import '../server/env.ts';
import { defineConfig } from 'drizzle-kit';
import { getDatabasePoolConfig, getDatabaseUrl } from './poolConfig.ts';

// Migration tooling may use a direct/session URL, but shares runtime TLS policy.
// No migration is run by importing this configuration.
const config = getDatabasePoolConfig({ ...process.env, DATABASE_URL: process.env.DIRECT_URL?.trim() || getDatabaseUrl() });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: { url: config.connectionString!, ssl: config.ssl } as any,
  verbose: true,
});
