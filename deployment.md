# Deployment

The maintained deployment instructions, environment-variable names, Supabase migration order and verification steps are in [README.md](README.md#vercel-deployment).

Use the migration files in numeric order, 001–012. Do not use `supabase_schema.sql` as a replacement. Authentication uses Supabase Auth Bearer sessions; there is no application SESSION_SECRET or browser-managed database connection string.

For the HTTP 500 investigation, connection repair, environment settings, and verification limits, see [Cloud connection repair](docs/cloud-connection-repair.md). Review and approve migrations individually before execution.

The serverless entry is now tracked `api/index.js`, loading generated `build/vercel.cjs`. Commit the launcher, build script and Vercel configuration together. See [Vercel module-resolution repair](docs/vercel-module-resolution.md) for the exact failure and validation evidence.
