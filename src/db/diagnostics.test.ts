import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDatabaseDiagnostic } from './diagnostics.ts';

test('nested ORM errors preserve exact safe TLS codes without private messages', () => {
  const error = new Error('SQL and private parameters', { cause: Object.assign(new Error('postgresql://user:private-password@host/db'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) });
  assert.deepEqual(getDatabaseDiagnostic(error), { kind: 'tls_error', code: 'SELF_SIGNED_CERT_IN_CHAIN', tlsReason: 'untrusted_certificate_chain' });
  assert.doesNotMatch(JSON.stringify(getDatabaseDiagnostic(error)), /private|postgresql:|SELECT/);
});

test('hostname mismatch, malformed CA, authentication and network failures stay distinct', () => {
  assert.equal(getDatabaseDiagnostic({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }).tlsReason, 'hostname_mismatch');
  assert.equal(getDatabaseDiagnostic({ code: 'DATABASE_SSL_CA_INVALID' }).tlsReason, 'invalid_ca_pem');
  assert.equal(getDatabaseDiagnostic({ code: '28P01' }).kind, 'authentication_failed');
  assert.equal(getDatabaseDiagnostic(new AggregateError([{ code: 'ENETUNREACH' }])).kind, 'network_unreachable');
  assert.equal(getDatabaseDiagnostic({ code: 'private-secret-code' }).code, undefined);
  const cyclic: any = { code: 'CERT_HAS_EXPIRED' }; cyclic.cause = cyclic;
  assert.equal(getDatabaseDiagnostic(cyclic).tlsReason, 'certificate_expired');
});
