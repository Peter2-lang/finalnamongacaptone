export function isDynamicImportFailure(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error ?? '');
  return /failed to fetch dynamically imported module|error loading dynamically imported module|dynamically imported module|chunkloaderror|loading chunk .* failed|failed to load module script|importing a module script failed|MIME type|unexpected token.*</i
    .test(message);
}

export function registerDynamicImportRecovery(): void {
  window.addEventListener('vite:preloadError', event => {
    const preloadEvent = event as Event & { payload?: unknown; detail?: unknown };
    const failure = preloadEvent.payload || preloadEvent.detail || event;
    console.error('Dynamic module preload failed; checking for a stale deployed asset.', failure);

    // Leave the rejection visible to React's error boundary. Recovery must be
    // an explicit user action, never an automatic reload that erases context.

  });
}
