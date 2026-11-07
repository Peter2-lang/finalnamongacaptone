declare const __APP_BUILD_ID__: string | undefined;

export const APP_BUILD_ID = (() => {
  const globalScope = typeof globalThis !== 'undefined' ? globalThis as Record<string, unknown> : {};
  const definedBuild = typeof __APP_BUILD_ID__ !== 'undefined' ? String(__APP_BUILD_ID__) : '';
  if (definedBuild) return definedBuild;
  const browserValue = typeof globalScope.__APP_BUILD_ID__ === 'string' ? globalScope.__APP_BUILD_ID__ : '';
  if (browserValue) return browserValue;
  const stamp = Date.now().toString(36);
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).__APP_BUILD_ID__ = stamp;
  }
  return stamp;
})();

export const APP_BUILD_STORAGE_KEY = 'da_hinunangan_build_id';
export const APP_BUILD_RELOAD_GUARD_KEY = 'da_hinunangan_build_reload_guard';

export function readStoredBuildId(): string | null {
  try {
    return localStorage.getItem(APP_BUILD_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistCurrentBuild(): string {
  try {
    localStorage.setItem(APP_BUILD_STORAGE_KEY, APP_BUILD_ID);
  } catch {
    // Storage may be unavailable in private mode; keep the running build version in memory only.
  }
  return APP_BUILD_ID;
}

export function wasBuildUpdated(): boolean {
  const stored = readStoredBuildId();
  if (!stored) {
    persistCurrentBuild();
    return false;
  }
  return stored !== APP_BUILD_ID;
}

export function markBuildReloaded(): boolean {
  const current = sessionStorage.getItem(APP_BUILD_RELOAD_GUARD_KEY);
  if (current === APP_BUILD_ID) return false;
  sessionStorage.setItem(APP_BUILD_RELOAD_GUARD_KEY, APP_BUILD_ID);
  return true;
}

export function initializeBuildTracking(): void {
  try {
    const stored = localStorage.getItem(APP_BUILD_STORAGE_KEY);
    if (!stored || stored !== APP_BUILD_ID) {
      localStorage.setItem(APP_BUILD_STORAGE_KEY, APP_BUILD_ID);
    }
  } catch {
    // Ignore storage limits/private mode issues.
  }
}
