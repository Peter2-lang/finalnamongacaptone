import { strict as assert } from 'node:assert';
import { isDynamicImportFailure, registerDynamicImportRecovery } from './chunkLoadRecovery';

assert.equal(isDynamicImportFailure(new Error('Failed to fetch dynamically imported module')), true);
assert.equal(isDynamicImportFailure('Loading chunk 42 failed'), true);
assert.equal(isDynamicImportFailure(new Error('Request failed')), false);

const listeners = new Map<string, EventListener>();
const values = new Map<string, string>();
let reloadCount = 0;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    location: { reload: () => reloadCount++ },
  },
});
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

registerDynamicImportRecovery();
const listener = listeners.get('vite:preloadError');
assert.ok(listener);

let firstEventPrevented = false;
listener({
  preventDefault: () => { firstEventPrevented = true; },
} as unknown as Event);
assert.equal(firstEventPrevented, true);
assert.equal(reloadCount, 1);

let secondEventPrevented = false;
listener({
  preventDefault: () => { secondEventPrevented = true; },
} as unknown as Event);
assert.equal(secondEventPrevented, false);
assert.equal(reloadCount, 1);

console.log('Dynamic import recovery tests passed.');
