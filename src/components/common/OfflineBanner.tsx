import React, { useState } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle, Database, Settings } from 'lucide-react';
import { useOfflineStatus } from '../../hooks/useOfflineStatus';
import { useLanguage } from '../../context/LanguageContext';
import { SyncCenterModal } from './SyncCenterModal';

interface OfflineBannerProps {
  onSyncComplete?: () => void;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ onSyncComplete }) => {
  const {
    isBrowserOnline,
    isBackendReachable,
    isSimulatedOffline,
    pendingQueueCount,
    lastError,
    forceSync,
    toggleSimulateOffline,
  } = useOfflineStatus();
  const { t } = useLanguage();
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const cloudIsReachable = isBrowserOnline && isBackendReachable && !isSimulatedOffline;
  const visibleError = syncError || (!cloudIsReachable ? lastError : null);
  const statusMessage = syncError
    ? 'Synchronization did not complete. See the error below.'
    : syncSuccess
      ? 'Cloud synchronization completed.'
      : isSimulatedOffline
        ? 'Offline test mode is active. Local changes will remain queued until it ends.'
        : !isBrowserOnline
          ? 'No internet connection. Local changes will sync when internet is restored.'
          : !isBackendReachable
            ? 'Cloud database is unreachable. Local changes will sync when the connection returns.'
            : pendingQueueCount > 0
              ? `${pendingQueueCount} change${pendingQueueCount === 1 ? '' : 's'} waiting to sync with the cloud.`
              : 'Connecting to the cloud database.';
  const shouldShowBanner = !cloudIsReachable || pendingQueueCount > 0 || Boolean(visibleError) || Boolean(syncSuccess);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncSuccess(null);
    try {
      const result = await forceSync();
      if (result.success) {
        setSyncSuccess(`Synchronized ${result.syncedCount} offline records successfully.`);
        onSyncComplete?.();
        window.setTimeout(() => setSyncSuccess(null), 5000);
      } else {
        setSyncError(
          result.error ||
            `Cloud synchronization did not complete. ${pendingQueueCount} change${pendingQueueCount === 1 ? '' : 's'} remain queued.`
        );
      }
    } catch (error) {
      setSyncError(
        error instanceof Error
          ? `Cloud synchronization failed: ${error.message}`
          : `Cloud synchronization failed: ${String(error)}`
      );
    } finally {
      setSyncing(false);
    }
  };

  if (!shouldShowBanner) {
    return (
      <SyncCenterModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        onSyncComplete={onSyncComplete}
      />
    );
  }

  return (
    <>
      <section
        aria-label="Connectivity and synchronization status"
        className={`relative z-30 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2 text-xs sm:px-4 sm:text-sm ${
          visibleError
            ? 'border-rose-300 border-l-4 bg-rose-50 text-rose-950'
            : cloudIsReachable && pendingQueueCount > 0
              ? 'border-amber-300 border-l-4 bg-amber-50 text-amber-950'
              : 'border-amber-300 border-l-4 bg-amber-50 text-amber-950'
        }`}
      >
        <div role="status" aria-live="polite" className="flex min-w-0 flex-1 items-start gap-2">
          {cloudIsReachable ? (
            <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : (
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="break-words font-semibold leading-snug">
              {cloudIsReachable ? 'Cloud connection active' : t('offline_banner_active', 'Offline mode active')}
              <span className="font-normal"> — {statusMessage}</span>
            </p>
            {visibleError && (
              <p className="mt-1 break-words text-[11px] font-medium text-rose-800">
                Sync issue: {visibleError}
              </p>
            )}
            {syncSuccess && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                {syncSuccess}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(!cloudIsReachable || pendingQueueCount > 0) && (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || (!isBrowserOnline && !isSimulatedOffline)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              title="Attempt to connect to the cloud database and synchronize queued changes"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>
                {syncing
                  ? t('sync_syncing', 'Connecting…')
                  : cloudIsReachable
                    ? t('sync_now', 'Sync now')
                    : 'Connect to Cloud DB'}
              </span>
            </button>
          )}

          {pendingQueueCount > 0 && (
            <button
              type="button"
              onClick={() => setIsSyncModalOpen(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 hover:bg-amber-100"
            >
              <Database className="h-4 w-4" />
              {pendingQueueCount} pending
            </button>
          )}

          <details className="relative">
            <summary
              className="flex min-h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden"
              aria-label="Sync settings"
              title="Sync settings"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-full z-50 mt-1 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-stone-200 bg-white p-2 shadow-xl">
              <button
                type="button"
                onClick={event => {
                  setIsSyncModalOpen(true);
                  event.currentTarget.closest('details')?.removeAttribute('open');
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-stone-100"
              >
                <Database className="h-4 w-4" />
                Open Sync Center and Settings
              </button>
              {isSimulatedOffline && (
                <button
                  type="button"
                  onClick={toggleSimulateOffline}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                >
                  <Wifi className="h-4 w-4" />
                  End offline simulation
                </button>
              )}
            </div>
          </details>
        </div>
      </section>

      <SyncCenterModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        onSyncComplete={onSyncComplete}
      />
    </>
  );
};
