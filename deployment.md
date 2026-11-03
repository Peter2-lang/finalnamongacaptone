# Deployment

The maintained deployment instructions, environment-variable names, Supabase migration order and verification steps are in [README.md](README.md#vercel-deployment).

Use the migration files in numeric order, 001–012. Do not use `supabase_schema.sql` as a replacement. Authentication uses Supabase Auth Bearer sessions; there is no application SESSION_SECRET or browser-managed database connection string.
