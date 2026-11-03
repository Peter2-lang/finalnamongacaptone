const tlsReasons: Record<string, string> = {
  SELF_SIGNED_CERT_IN_CHAIN: 'untrusted_certificate_chain',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'untrusted_certificate_chain',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'incomplete_certificate_chain',
  UNABLE_TO_GET_ISSUER_CERT: 'missing_issuer_certificate',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'missing_issuer_certificate',
  CERT_HAS_EXPIRED: 'certificate_expired',
  CERT_NOT_YET_VALID: 'certificate_not_yet_valid',
  ERR_TLS_CERT_ALTNAME_INVALID: 'hostname_mismatch',
  ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED: 'unsupported_certificate_signature',
  ERR_SSL_WRONG_VERSION_NUMBER: 'tls_protocol_mismatch',
  ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION: 'tls_protocol_mismatch',
  ERR_OSSL_PEM_NO_START_LINE: 'invalid_ca_pem',
  DATABASE_SSL_CA_INVALID: 'invalid_ca_pem',
  DATABASE_SSL_CA_NOT_CA: 'certificate_is_not_a_ca',
  DATABASE_SSL_CA_EXPIRED: 'ca_certificate_expired',
  DATABASE_SSL_CA_NOT_YET_VALID: 'ca_certificate_not_yet_valid',
};
const networkKinds: Record<string, string> = {
  ENOTFOUND: 'host_not_found', EAI_AGAIN: 'host_not_found', ECONNREFUSED: 'connection_refused',
  ETIMEDOUT: 'connection_timeout', ENETUNREACH: 'network_unreachable',
  EHOSTUNREACH: 'network_unreachable', ECONNRESET: 'network_unreachable',
};

/** Classify nested driver/ORM errors without logging messages or arbitrary codes. */
export function getDatabaseDiagnostic(error: unknown): { kind: string; code?: string; tlsReason?: string } {
  const errors: Array<{ code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] }> = [];
  const queue = [error];
  const seen = new Set<unknown>();
  while (queue.length && errors.length < 8) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const item = current as typeof errors[number];
    errors.push(item);
    queue.push(item.cause, ...(Array.isArray(item.errors) ? item.errors.slice(0, 8) : []));
  }
  const codes = errors.map(item => typeof item.code === 'string' ? item.code : '');
  const tlsCode = codes.find(code => Object.hasOwn(tlsReasons, code));
  if (tlsCode) return { kind: 'tls_error', code: tlsCode, tlsReason: tlsReasons[tlsCode] };
  const code = codes.find(code => Object.hasOwn(networkKinds, code) || /^[0-9A-Z]{5}$/.test(code) || code === 'CONFIGURATION_ERROR');
  if (code === 'CONFIGURATION_ERROR') return { kind: 'configuration_error', code };
  if (code === '28P01' || code === '28000') return { kind: 'authentication_failed', code };
  if (code && Object.hasOwn(networkKinds, code)) return { kind: networkKinds[code], code };
  if (code === '42703' || code === '42P01') return { kind: 'schema_error', code };
  if (code === '42501') return { kind: 'permission_denied', code };
  if (code === '3D000') return { kind: 'database_not_found', code };
  const message = errors.map(item => typeof item.message === 'string' ? item.message : '').join(' ').toLowerCase();
  if (/certificate|ssl|tls/.test(message)) return { kind: 'tls_error', ...(code ? { code } : {}), tlsReason: /does not support ssl/.test(message) ? 'server_does_not_support_tls' : 'tls_failure' };
  if (/timeout|timed out/.test(message)) return { kind: 'connection_timeout', ...(code ? { code } : {}) };
  return { kind: 'connection_failed', ...(code ? { code } : {}) };
}
