const CHUNK_RELOAD_ATTEMPT_KEY = 'app:chunk-load-reload-attempted';

export function isDynamicImportFailure(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error ?? '');
  return /failed to fetch dynamically imported module|error loading dynamically imported module|dynamically imported module|chunkloaderror|loading chunk .* failed/i
    .test(message);
}

export function registerDynamicImportRecovery(): void {
  window.addEventListener('vite:preloadError', event => {
    const preloadEvent = event as Event & { payload?: unknown; detail?: unknown };
    const failure = preloadEvent.payload || preloadEvent.detail || event;
    console.error('Dynamic module preload failed; checking for a stale deployed asset.', failure);

    try {
      if (sessionStorage.getItem(CHUNK_RELOAD_ATTEMPT_KEY) === '1') return;
      sessionStorage.setItem(CHUNK_RELOAD_ATTEMPT_KEY, '1');
    } catch (storageError) {
      console.error('Automatic recovery was skipped because session storage is unavailable.', storageError);
      return;
    }

    event.preventDefault();
    window.location.reload();
  });
}
