import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './context/LanguageContext';
import { OfflineProvider } from './context/OfflineContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { registerDynamicImportRecovery } from './utils/chunkLoadRecovery';
import './index.css';

registerDynamicImportRecovery();
// Retire authenticated responses cached by older service-worker releases.
if ('caches' in window) {
  void caches.delete('api-runtime-cache').catch(() => { /* Cache storage may be unavailable in private mode. */ });
}

// Global quota and auth error tap for Google Maps Platform
(window as any).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};
const origError = console.error;
console.error = (...args: unknown[]) => {
  const msg = args.map((a) => String(a)).join(' ');
  // Ignore benign Vite HMR websocket connection messages in container preview environment
  if (
    msg.includes('failed to connect to websocket') ||
    msg.includes('vite-pwa-plugin') ||
    msg.includes('[vite]')
  ) {
    return;
  }
  origError.apply(console, args);
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('[vite]') || msg.includes('websocket')) {
    return;
  }
  origWarn.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <OfflineProvider>
          <App />
        </OfflineProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
