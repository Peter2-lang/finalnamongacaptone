import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, createServer } from 'node:tls';
import type { ConnectionOptions } from 'node:tls';
import { test } from 'node:test';
import { getDatabasePoolConfig, parseDatabaseCa } from './poolConfig.ts';

// Local TLS fixture only. This is not a claim of a live PostgreSQL connection.
test('configured trust accepts the right CA and hostname and rejects either mismatch', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'swine-tls-'));
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  let server: ReturnType<typeof createServer> | undefined;
  try {
    openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=RegistryTestCA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-days', '1', '-keyout', 'ca.key', '-out', 'ca.crt');
    openssl('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=localhost', '-keyout', 'server.key', '-out', 'server.csr');
    writeFileSync(join(dir, 'server.ext'), 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n');
    openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '1', '-extfile', 'server.ext', '-out', 'server.crt');
    const ca = readFileSync(join(dir, 'ca.crt'), 'utf8');
    assert.throws(() => parseDatabaseCa(readFileSync(join(dir, 'server.crt'), 'utf8')), { code: 'DATABASE_SSL_CA_NOT_CA' });
    server = createServer({ key: readFileSync(join(dir, 'server.key')), cert: readFileSync(join(dir, 'server.crt')) }, socket => socket.end());
    server.on('tlsClientError', () => {});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const config = getDatabasePoolConfig({ DATABASE_URL: 'postgresql://test:test@db.example.com/postgres?ssl=no-verify', DATABASE_SSL_CA: ca.replaceAll('\n', '\\n') });
    const handshake = (ssl: ConnectionOptions, servername: string) => new Promise<void>((resolve, reject) => {
      const socket = connect({ ...ssl, host: '127.0.0.1', port, servername });
      socket.once('secureConnect', () => { assert.equal(socket.authorized, true); socket.end(); resolve(); });
      socket.once('error', error => { socket.destroy(); reject(error); });
    });
    await handshake(config.ssl as ConnectionOptions, 'localhost');
    await assert.rejects(handshake(config.ssl as ConnectionOptions, 'wrong.example.com'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    const noCa = getDatabasePoolConfig({ DATABASE_URL: 'postgresql://test:test@db.example.com/postgres' });
    await assert.rejects(handshake(noCa.ssl as ConnectionOptions, 'localhost'), (error: any) => /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY/.test(error.code));
  } finally {
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
