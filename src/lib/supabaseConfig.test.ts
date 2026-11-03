import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBrowserSupabaseConfig } from './supabaseConfig.ts';

test('build rejects privileged browser keys in both supported formats', () => {
  const jwt = `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
  for (const key of ['sb_secret_example', jwt]) {
    assert.throws(() => validateBrowserSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: key }), /privileged/);
  }
});

test('frontend and backend project configuration must agree', () => {
  assert.throws(() => validateBrowserSupabaseConfig({ SUPABASE_URL: 'https://one.supabase.co', VITE_SUPABASE_URL: 'https://two.supabase.co' }), /must match/);
});
