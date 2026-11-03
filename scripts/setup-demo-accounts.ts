import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import '../src/server/env.ts';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { parse } from 'dotenv';
import { DEMO_ACCOUNTS } from '../src/data/demoAccounts.ts';
import { pool } from '../src/db/index.ts';
import { getUserByUsernameOrEmail, insertUserProfile } from '../src/db/users.ts';
import { supabaseAdminClient } from '../src/lib/supabaseServer.ts';

const credentialsPath = '.env.demo-accounts';
const passwordNames = ['DEMO_ADMIN_PASSWORD', 'DEMO_BARANGAY_PASSWORD', 'DEMO_AGENT_PASSWORD'];
const passwords = existsSync(credentialsPath) ? parse(readFileSync(credentialsPath)) : {};
for (const key of passwordNames) passwords[key] ||= `Demo!9aA${randomBytes(18).toString('base64url')}`;
writeFileSync(credentialsPath, '# Private demo passwords. Never commit or publish this file.\n' + passwordNames.map(key => `${key}=${passwords[key]}`).join('\n') + '\n', { mode: 0o600 });
chmodSync(credentialsPath, 0o600);

async function main() {
  for (const account of DEMO_ACCOUNTS) console.log(`${account.username}: ${account.role}${account.assignedBarangay ? ` (${account.assignedBarangay})` : ''} — ${account.email}`);
  console.log(`Passwords are stored privately in ${credentialsPath}; omitted from logs.`);
  if (!process.argv.includes('--apply')) {
    console.log('Plan only: no cloud access or changes. --apply creates three real Supabase accounts and application profiles.');
    return;
  }
  if (!supabaseAdminClient) throw new Error('Configure the server Supabase URL and secret key first.');

  // Complete read-only collision/schema checks before creating any account.
  await pool.query('SELECT id, uid, email, auth_user_id, role, assigned_barangay, active, is_active, status, permissions FROM public.users LIMIT 0');
  const barangay = await pool.query('SELECT id FROM public.barangays WHERE lower(name) = lower($1)', ['Ambacon']);
  if (barangay.rows.length !== 1) throw new Error('Ambacon must exist exactly once in barangays. No records were changed.');
  const authUsers: SupabaseAuthUser[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabaseAdminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Auth account preflight failed (${error.status || 'unknown'}).`);
    authUsers.push(...data.users);
    if (data.users.length < 100) break;
  }
  const plans = [];
  for (const account of DEMO_ACCOUNTS) {
    const [byName, byEmail] = await Promise.all([getUserByUsernameOrEmail(account.username), getUserByUsernameOrEmail(account.email)]);
    const authMatches = authUsers.filter(user => user.email === account.email || user.user_metadata?.username === account.username);
    if (authMatches.length > 1) throw new Error(`Conflicting demo identity: ${account.username}. No existing account will be changed.`);
    const authUser = authMatches[0];
    if (authUser && (authUser.email !== account.email || authUser.user_metadata?.demo_registry_account !== true || authUser.user_metadata?.username !== account.username)) {
      throw new Error(`Existing Auth identity is not a managed demo account: ${account.username}.`);
    }
    const profile = byName || byEmail;
    if (profile && (profile.authUserId !== authUser?.id || profile.username !== account.username || profile.email !== account.email || profile.role !== account.role || profile.assignedBarangay !== account.assignedBarangay || !profile.active)) {
      throw new Error(`Existing application identity conflicts: ${account.username}. No account will be overwritten.`);
    }
    plans.push({ account, authUser, profile });
  }
  for (const [index, plan] of plans.entries()) {
    const { account, profile } = plan;
    if (profile) { console.log(`${account.username}: already exists; left unchanged.`); continue; }
    let authUser = plan.authUser;
    if (!authUser) {
      const result = await supabaseAdminClient.auth.admin.createUser({
        email: account.email, password: passwords[passwordNames[index]], email_confirm: true,
        user_metadata: { username: account.username, full_name: account.name, demo_registry_account: true },
      });
      if (result.error || !result.data.user) throw new Error(`Demo Auth creation failed for ${account.username} (${result.error?.status || 'unknown'}).`);
      authUser = result.data.user;
    }
    await insertUserProfile({ uid: account.username, username: account.username, email: account.email,
      authUserId: authUser.id, name: account.name, role: account.role, assignedBarangay: account.assignedBarangay,
      active: true, isActive: true, status: 'active', permissions: [],
    });
    console.log(`${account.username}: created with normal ${account.role} permissions.`);
  }
}

try { await main(); } catch {
  console.error('Demo provisioning stopped. Check configuration and account collisions. Existing accounts were not overwritten; a newly created Auth account may need its profile completed by rerunning.');
  process.exitCode = 1;
} finally { await pool.end(); }
