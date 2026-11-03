# PostgreSQL TLS investigation and secure configuration

## Current evidence and unresolved production cause

A read-only request to the production health endpoint confirmed HTTP 503, database error, Auth available and `tls_error`. The function now loads. The response contains no detailed TLS code because the previous diagnostic filter accepted PostgreSQL/network codes but discarded Node's underscore-separated TLS codes. There is no Vercel log connector or current database configuration in this workspace. DATABASE_URL, DIRECT_URL and DATABASE_SSL_CA are absent here. The exact deployed certificate error and the current deployed connection mode therefore remain unconfirmed. No real Supabase database connection succeeded during this work, and the production issue is not claimed fixed.

Previously supplied host db.<project>.supabase.co:5432 is a direct connection, but it is not evidence of the current Vercel DATABASE_URL. The application's new safe server logs report the effective variable name and detected mode without returning a connection string or hostname. For Supabase shared pooler hosts, 5432 is session mode and 6543 is transaction mode; db.<project>.supabase.co:6543 is the dedicated pooler. Copy the exact hostname from Connect; do not guess a pooler region/index.

The driver is node-postgres (`pg`), used directly and through Drizzle's node-postgres adapter. A shared runtime pool is retained. No application call to `.prepare()` or named pg query was found. Normal Drizzle/pg parameterized queries use unnamed statements; the Postgres.js-specific `prepare: false` option does not apply to this driver. Current transaction-scoped operations remain unchanged.

## Confirmed code flaw and changes

Before the patch, `?ssl=no-verify` survived URI normalization. Instantiating a real pg Client with the resulting configuration changed its effective rejectUnauthorized to false. This is a reproduced configuration vulnerability, not evidence that production uses that parameter or that it explains the current TLS failure.

The runtime and migration tooling now share one TLS policy:

- Remove pg URI SSL switches, including `ssl`, before passing the explicit verified SSL object to pg. URI SSL options otherwise replace the explicit CA/verification object. Standard PostgreSQL SSL negotiation is selected explicitly.
- Remote connections require certificate validation and Node's standard hostname verifier. No disabled verification or hostname override is introduced.
- With no DATABASE_SSL_CA, keep Node's default trust store. With DATABASE_SSL_CA, use the explicitly supplied CA bundle. A wrong/unrelated custom CA can replace otherwise sufficient default trust; it must match the selected endpoint.
- Parse actual multiline PEM, literal backslash-n, CRLF, escaped CRLF and optional surrounding quotes. Ordinary escaped newlines already worked before this change. Blank values use default trust. Validate real X.509 CA certificates and their validity periods. Reject malformed content, file paths, leaf certificates, expired/future CAs or appended non-certificate text before opening a connection. Never echo the supplied content.
- Preserve exact allowlisted TLS codes and safe reasons through nested Drizzle/pg errors. Health remains 503 for failures and 200 only when the existing database/schema/Auth checks pass. Server logs include the selected connection variable, mode and whether a custom CA is configured. They omit SQL, passwords, URI, certificate content and raw error messages.
- Drizzle migration config prefers DIRECT_URL but uses the same CA parser and verification settings. It requires a configured URL rather than silently falling back to unencrypted localhost. No migration was run.

References: [node-postgres SSL option precedence](https://node-postgres.com/features/ssl), [Supabase certificate verification and CA download](https://supabase.com/docs/guides/platform/ssl-enforcement), [Supabase endpoint modes and transaction-pooler limitations](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Vercel environment settings

1. DATABASE_URL: server-only, copy the exact Transaction pooler URI from Supabase Connect for Vercel. Preserve its username/project suffix and URL-encode only the password component. Do not paste an HTTPS Supabase project URL or API key. DATABASE_URL takes precedence over legacy SUPABASE_DATABASE_URL and POSTGRES_URL. DIRECT_URL is not the application runtime URL.
2. DATABASE_SSL_CA: when the selected endpoint's chain is not trusted by Node, download the CA from the same project's Database Settings / SSL Configuration, and paste the complete PEM content into the server-only Vercel variable. Include BEGIN/END CERTIFICATE lines. Both actual newlines and literal backslash-n are supported. Do not paste a filesystem path, JWT, password or server leaf certificate. Multiple CA PEM blocks are supported.
3. DIRECT_URL: optional migration-tooling direct/session URI; if used, its endpoint must be trusted by the configured CA bundle too. No migration is necessary for a TLS trust failure.
4. Retain the existing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and matching VITE public values. Auth being available does not prove PostgreSQL TLS works: Auth uses HTTPS and a separate connection.

Do not rotate/rewrite unrelated environment values blindly. Diagnose the exact error first. No production environment was modified by this work.

## Read the exact safe error and resolve it

After deployment, health includes database_error_code and database_tls_reason for known TLS failures. Vercel runtime logs under `[HEALTH] dependency_check_failed` include the same code/reason and safe connection metadata.

| Code/reason | Next action |
| --- | --- |
| SELF_SIGNED_CERT_IN_CHAIN, DEPTH_ZERO_SELF_SIGNED_CERT | Verify the matching database CA is configured; do not disable verification. |
| UNABLE_TO_GET_ISSUER_CERT_LOCALLY, UNABLE_TO_VERIFY_LEAF_SIGNATURE | Check CA/intermediate trust and whether a custom CA matches this specific endpoint. |
| ERR_TLS_CERT_ALTNAME_INVALID | Recopy the actual endpoint hostname. Do not override servername or hostname validation. |
| CERT_HAS_EXPIRED, CERT_NOT_YET_VALID | Check certificate validity and clock; obtain the current CA or contact Supabase for a server-certificate issue. |
| DATABASE_SSL_CA_INVALID / NOT_CA / EXPIRED / NOT_YET_VALID | Correct the PEM content using the project's current CA certificate. |
| ERR_SSL_WRONG_VERSION_NUMBER / server_does_not_support_tls | Verify this is the PostgreSQL host/port and standard PostgreSQL SSL negotiation. |

The messages above describe possible causes. None is asserted to be the current production cause until its actual error code and configuration are observed.

## Verify a real database connection

With current credentials configured privately in .env.local or the process environment:

```
node --import tsx scripts/check-database.ts
```

This uses the actual runtime pg/TLS configuration, opens a real connection and runs only SELECT 1. A successful remote result must say database connected and tlsVerified true. Failures return only safe diagnostics and a nonzero exit code. Do not paste credentials into shell commands or chat. The script was run here and correctly reported missing configuration, not a successful database connection.

Review and approve production environment changes/deployment. Run `npm run lint`, `npm test` and `npm run build`; deploy Preview with its intended database settings first. After successful real verification, redeploy the production environment and request https://lguhinunanganswineregistry.vercel.app/api/health. Confirm HTTP 200 with database connected, authentication available and cloud online. A continuing 503 means the connection is still unresolved; use its exact safe code rather than hiding the error.

Regression tests include X.509 parsing, pg's effective SSL options, safe error classification, health JSON, and actual local TLS handshakes accepting correct CA/hostname and rejecting wrong hostname/untrusted certificates. The local TLS fixture is not a production PostgreSQL server or proof of Supabase connectivity. No database data/schema, frontend, permissions or synchronization behavior was changed.

## Changed files and checks

- `src/db/poolConfig.ts`, `src/db/poolConfig.test.ts`: URI SSL normalization, verified CA/hostname policy, PEM validation and safe connection metadata.
- `src/db/diagnostics.ts`, `src/db/diagnostics.test.ts`: safe nested TLS/PostgreSQL/network classification.
- `src/db/tls.test.ts`: real local TLS handshake regression tests using ephemeral certificates.
- `src/db/index.ts`, `src/server/app.ts`, `src/server/health.test.ts`: safe pool/health diagnostics and exact allowlisted error codes.
- `src/db/drizzle.config.ts`: matching migration-tool TLS configuration; no migration executed.
- `scripts/check-database.ts`: read-only real connection verification command.
- `.env.example`, this report: private configuration/deployment instructions.

Type checks and production build passed. All 44 tests passed on Node 24 and Node 22.23.4, including the real local TLS handshakes. The real-database diagnostic correctly exited nonzero because this workspace has no DATABASE_URL. This is a verification limitation, not a successful database connection. Production settings and deployment were not modified.
