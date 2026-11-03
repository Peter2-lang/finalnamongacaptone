# Demo login accounts

Enable `VITE_ENABLE_DEMO_LOGIN=true` in the local .env (or intended Vercel build environment) to show three shortcuts in the login dialog. They fill the username only and always use normal Supabase authentication.

| Username | Role | Scope |
| --- | --- | --- |
| demo_admin | admin | Existing municipal admin permissions |
| demo_barangay | focal | Ambacon |
| demo_agent | agent | Existing agent permissions |

Prepare the account plan and private generated passwords without network access:

```
node --import tsx scripts/setup-demo-accounts.ts
```

Passwords are in Git-ignored `.env.demo-accounts`, accessible only to the file owner. Use the corresponding password in the login form; no password or privileged key is embedded in browser assets. Do not publish that file. These are real accounts, not an offline authentication bypass.

After approval to create accounts in the configured cloud database, run:

```
node --import tsx scripts/setup-demo-accounts.ts --apply
```

This needs DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY. Preflight checks schema, Ambacon and identity collisions. The script inserts three Auth users and linked profiles, never resets existing passwords or overwrites existing accounts, and can resume a profile insert after partial failure. Do not delete/regenerate the password file after provisioning: those passwords belong to the existing accounts. Existing accounts are skipped without verifying or changing their passwords.

The demo admin has real admin capabilities. Use an isolated demo project when demonstrations must not affect existing records. Provisioning does not seed, delete or modify swine records or change application role permissions.
