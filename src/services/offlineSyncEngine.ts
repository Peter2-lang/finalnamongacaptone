import { getConnectivityState } from './connectivityState.ts';
import { supabase } from '../lib/supabase.ts';
import { getSyncSessionToken } from './syncAuth.ts';
import { createBackendHealthCheck } from './backendHealth.ts';
/**
 * Central Offline Synchronization Engine
 * Handles automatic network detection, background syncing, topological queue execution,
 * server pull-merges, conflict handling, and local IndexedDB state updates.
 */

import { indexedDbService, OfflineSyncQueueRecord, OfflineMediaRecord } from './indexedDbService';
import { storageService } from './storageService';
import { SwineRecord, IssuedCertificate, MessageItem, Barangay } from '../types';

export type SyncState = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNCED' | 'ERROR';

export interface SyncEngineStatus {
  state: SyncState;
  isOnline: boolean;
  isBackendReachable: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncedThisSession: number;
}

class OfflineSyncEngine {
  private syncState: SyncState = 'ERROR';
  private isBackendReachable: boolean = false;
  private healthFailures = 0;
  private nextHealthCheckAt = 0;
  private readonly checkBackendHealth = createBackendHealthCheck();
  private lastHealthError: string | null = null;
  private isSyncInProgress: boolean = false;
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private syncedCountSession: number = 0;
  private healthIntervalId: any = null;

  constructor() {
    this.init();
  }

  private init() {
    if (typeof window === 'undefined') return;

    // Load last sync metadata from IndexedDB
    indexedDbService.getSyncMetadata().then(meta => {
      if (meta && meta.lastSyncedAt) {
        this.lastSyncedAt = meta.lastSyncedAt;
      }
      this.broadcastStatus();
    }).catch(() => {});

    // Retry saved offline operations when a verified user profile is set.
    window.addEventListener('da_auth_profile_changed', () => {
      if (storageService.getCurrentUser()) void this.checkConnectivityAndAutoSync('profile_signed_in');
    });

    // Listen to browser network events
    window.addEventListener('online', () => {
      this.checkConnectivityAndAutoSync('network_online_event');
    });

    window.addEventListener('offline', () => {
      this.setOfflineState('Browser offline event triggered');
    });

    // Listen to simulated offline toggle
    window.addEventListener('da_connectivity_change', (e: any) => {
      if (e.detail?.isSimulatedOffline) {
        this.setOfflineState('Simulated offline active');
      } else {
        this.checkConnectivityAndAutoSync('simulation_disabled');
      }
    });

    // Listen for visibility change to auto-sync when tab gains focus
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkConnectivityAndAutoSync('tab_visible');
      }
    });

    // Periodic connectivity & sync loop (every 25 seconds)
    this.healthIntervalId = setInterval(() => {
      if (Date.now() >= this.nextHealthCheckAt) this.checkConnectivityAndAutoSync('interval_heartbeat');
    }, 25000);

    // Initial background sync check on boot
    setTimeout(() => {
      this.checkConnectivityAndAutoSync('app_start');
    }, 1500);
  }

  public getStatus(): SyncEngineStatus {
    const isSimulated = storageService.getSimulatedOffline();
    const { isOnline, state } = getConnectivityState({
      browserOnline: typeof navigator === 'undefined' || navigator.onLine,
      simulatedOffline: isSimulated, backendReachable: this.isBackendReachable,
      syncing: this.isSyncInProgress, state: this.syncState,
    });

    return {
      state,
      isOnline,
      isBackendReachable: this.isBackendReachable && !isSimulated,
      pendingCount: 0, // dynamic
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastHealthError || this.lastError,
      syncedThisSession: this.syncedCountSession,
    };
  }

  private broadcastStatus(pendingCount?: number) {
    if (typeof window === 'undefined') return;

    const countPromise = pendingCount !== undefined
      ? Promise.resolve(pendingCount)
      : indexedDbService.getPendingSyncQueue().then(q => q.length).catch(() => 0);

    countPromise.then(cnt => {
      const status: SyncEngineStatus = {
        ...this.getStatus(),
        pendingCount: cnt,
      };
      window.dispatchEvent(new CustomEvent('da_sync_status_updated', { detail: status }));
    });
  }

  private setOfflineState(reason?: string) {
    this.syncState = 'OFFLINE';
    this.isBackendReachable = false;
    if (reason === 'Browser offline event triggered') this.lastHealthError = 'Your browser is offline. Reconnect to the internet before synchronizing.';
    if (reason === 'Simulated offline active') this.lastHealthError = 'Offline simulation is enabled. End offline simulation in Sync settings.';
    this.broadcastStatus();
  }

  /**
   * Health Ping to check actual backend reachability
   */
  public async pingBackend(): Promise<boolean> {
    const result = storageService.getSimulatedOffline()
      ? { healthy: false, error: 'Offline simulation is enabled. End offline simulation in Sync settings.' }
      : typeof navigator !== 'undefined' && !navigator.onLine
        ? { healthy: false, error: 'Your browser is offline. Reconnect to the internet before synchronizing.' }
        : await this.checkBackendHealth();
    // A user may switch simulation on while the network request is still pending.
    const simulated = storageService.getSimulatedOffline();
    const browserOnline = typeof navigator === 'undefined' || navigator.onLine;
    this.isBackendReachable = result.healthy && !simulated && browserOnline;
    this.lastHealthError = simulated ? 'Offline simulation is enabled. End offline simulation in Sync settings.'
      : !browserOnline ? 'Your browser is offline. Reconnect to the internet before synchronizing.' : result.error;
    this.healthFailures = this.isBackendReachable ? 0 : this.healthFailures + 1;
    this.nextHealthCheckAt = Date.now() + Math.min(25000 * 2 ** Math.min(this.healthFailures, 4), 300000);
    return this.isBackendReachable;
  }

  public async checkConnectivityAndAutoSync(triggerSource: string = 'manual'): Promise<void> {
    const isReachable = await this.pingBackend();
    if (isReachable) {
      const pending = await indexedDbService.getPendingSyncQueue().catch(() => []);
      if (pending.length > 0) {
        await this.syncNow();
      } else {
        // When there is nothing to sync, stop showing an old sign-in warning.
        // Verify the current session before clearing an authenticated user's
        // previous error; no offline data is touched.
        if (!storageService.getCurrentUser()) this.lastError = null;
        else if (this.lastError) {
          try {
            await getSyncSessionToken(supabase?.auth || null, storageService.getCurrentUser());
            this.lastError = null;
          } catch { /* Preserve a real authorization failure until sign-in. */ }
        }
        this.syncState = this.lastError ? 'ERROR' : this.lastSyncedAt ? 'SYNCED' : 'ONLINE';
        this.broadcastStatus(0);
      }
    } else {
      this.setOfflineState(`Connectivity check failed from ${triggerSource}`);
    }
  }

  public async syncNow(): Promise<{ success: boolean; pushedCount: number; pulledCount: number; error?: string }> {
    if (this.isSyncInProgress) {
      return { success: false, pushedCount: 0, pulledCount: 0, error: 'Sync already in progress' };
    }

    const isReachable = await this.pingBackend();
    if (!isReachable) {
      this.syncState = 'OFFLINE';
      this.broadcastStatus();
      return { success: false, pushedCount: 0, pulledCount: 0, error: this.lastHealthError || 'The backend health check failed. Open /api/health to inspect the deployment.' };
    }

    // Another caller may have started syncing while both awaited the shared health check.
    if (this.isSyncInProgress) return { success: false, pushedCount: 0, pulledCount: 0, error: 'Sync already in progress' };
    this.isSyncInProgress = true;
    this.syncState = 'SYNCING';
    this.broadcastStatus();

    let pushedCount = 0;
    let pulledCount = 0;

    try {
      // Do not upload device-local operations without an authenticated profile.
      const sessionToken = await getSyncSessionToken(supabase?.auth || null, storageService.getCurrentUser());
      // -------------------------------------------------------------
      // STEP 1: PUSH PENDING OPERATIONS QUEUE
      // -------------------------------------------------------------
      const pendingQueue = await indexedDbService.getPendingSyncQueue();

      if (pendingQueue.length > 0) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        };

        const pushPayload = {
          operations: pendingQueue.map(item => ({
            clientOperationId: item.clientOperationId,
            operation: item.operation,
            entity: item.entity,
            entityId: item.entityId,
            payload: item.payload,
          })),
        };

        const pushRes = await fetch('/api/sync/push', {
          method: 'POST',
          headers,
          body: JSON.stringify(pushPayload),
        });

        if (!pushRes.ok) {
          const failure = await pushRes.json().catch(() => null);
          throw new Error(failure?.error || `Database rejected sync push (HTTP ${pushRes.status}).`);
        }
        const pushData = await pushRes.json();
        if (!pushData.success || !Array.isArray(pushData.results)) {
          throw new Error('Database returned an invalid sync-push response.');
        }
        const acknowledgedIds = new Set(pushData.results.map((item: any) => item.clientOperationId));
        if (acknowledgedIds.size !== pendingQueue.length ||
            pendingQueue.some(item => !acknowledgedIds.has(item.clientOperationId))) {
          throw new Error('Database did not acknowledge every queued operation.');
        }
        let pushError: string | null = null;
        for (const resItem of pushData.results) {
          const matchedQueue = pendingQueue.find(q => q.clientOperationId === resItem.clientOperationId);
          if (!matchedQueue) continue;

          if (!resItem.success) {
            await indexedDbService.updateQueueItemStatus(matchedQueue.id, 'FAILED', resItem.error);
            pushError ||= resItem.error || 'Database rejected a queued operation.';
            continue;
          }

          if (matchedQueue.entity === 'swine') {
            await indexedDbService.acknowledgeSwineOperation(matchedQueue, resItem.serverEntityId, resItem.serverPigId);
          } else {
            await indexedDbService.removeQueueItem(matchedQueue.id);
          }
          pushedCount++;
        }
        if (pushError) throw new Error(pushError);
      }

      // -------------------------------------------------------------
      // STEP 2: PULL AUTHORITATIVE SERVER DATA
      // -------------------------------------------------------------
      // Refresh again before pull because uploads may have taken time.
      const pullToken = await getSyncSessionToken(supabase?.auth || null, storageService.getCurrentUser());
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pullToken}`,
      };

      const pullRes = await fetch('/api/sync/pull', { method: 'GET', headers });
      if (!pullRes.ok) {
        const failure = await pullRes.json().catch(() => null);
        throw new Error(failure?.error || `Database rejected sync pull (HTTP ${pullRes.status}).`);
      }
      const pullData = await pullRes.json();
      if (!pullData.success || !pullData.data) {
        throw new Error(pullData.error || 'Database returned an invalid sync-pull response.');
      }
      const { swineRecords, certificates, messages } = pullData.data;
      if (!Array.isArray(swineRecords)) {
        throw new Error('Database returned no authoritative swine-record list.');
      }

      // Merge server state with local records that still have unacknowledged operations.
      pulledCount = swineRecords.length;
      const finalMergedList = (await indexedDbService.mergeCloudSwineRecords<SwineRecord>(swineRecords)).sort(
        (a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime()
      );

      storageService.saveSwineRecords(finalMergedList);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('swine_records_updated', { detail: finalMergedList }));
      }

      if (Array.isArray(certificates)) {
        await indexedDbService.putBatch('certificates', certificates);
      }
      if (Array.isArray(messages)) {
        await indexedDbService.putBatch('messages', messages);
      }

      // -------------------------------------------------------------
      // STEP 3: UPDATE METADATA & COMPLETE
      // -------------------------------------------------------------
      const now = new Date().toISOString();
      this.lastSyncedAt = now;
      this.lastError = null;
      this.syncedCountSession += pushedCount;
      this.syncState = 'SYNCED';

      await indexedDbService.updateSyncMetadata({
        lastSyncedAt: now,
        lastSyncStatus: 'SUCCESS',
        totalSyncedCount: this.syncedCountSession,
        pendingCount: 0,
      });

      this.broadcastStatus(0);

      return { success: true, pushedCount, pulledCount };
    } catch (err: any) {
      console.error('Sync process error:', err);
      this.lastError = err?.message || 'Synchronization failed';
      this.syncState = 'ERROR';
      this.broadcastStatus();
      return { success: false, pushedCount, pulledCount, error: this.lastError || undefined };
    } finally {
      this.isSyncInProgress = false;
      this.broadcastStatus();
    }
  }

  // =========================================================================
  // QUEUE OPERATIONS FOR OFFLINE ACTIONS
  // =========================================================================

  public async queueSwineCreate(record: SwineRecord): Promise<void> {
    const localRecord: SwineRecord = {
      ...record,
      isSynced: false,
      updatedAt: new Date().toISOString(),
    };
    await indexedDbService.put('swineRecords', localRecord);

    await indexedDbService.enqueueSyncItem('create', 'swine', localRecord.id, localRecord, 2);

    const currentList = storageService.getSwineRecords();
    const updated = [localRecord, ...currentList.filter(s => s.id !== localRecord.id)];
    storageService.saveSwineRecords(updated);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('swine_records_updated', { detail: updated }));
    }

    this.checkConnectivityAndAutoSync('swine_create');
  }

  public async queueSwineUpdate(record: SwineRecord): Promise<void> {
    const localRecord: SwineRecord = {
      ...record,
      isSynced: false,
      updatedAt: new Date().toISOString(),
    };
    await indexedDbService.put('swineRecords', localRecord);
    await indexedDbService.enqueueSyncItem('update', 'swine', localRecord.id, localRecord, 2);

    const currentList = storageService.getSwineRecords();
    const updated = currentList.map(s => (s.id === localRecord.id ? localRecord : s));
    storageService.saveSwineRecords(updated);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('swine_records_updated', { detail: updated }));
    }

    this.checkConnectivityAndAutoSync('swine_update');
  }

  public async queueSwineDelete(id: string): Promise<void> {
    await indexedDbService.delete('swineRecords', id);
    await indexedDbService.enqueueSyncItem('delete', 'swine', id, { id }, 2);

    const currentList = storageService.getSwineRecords();
    const updated = currentList.filter(s => s.id !== id);
    storageService.saveSwineRecords(updated);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('swine_records_updated', { detail: updated }));
    }

    this.checkConnectivityAndAutoSync('swine_delete');
  }

  public async queueSwineSell(id: string, readyToSell: boolean, priceEstimate?: number): Promise<void> {
    const local = await indexedDbService.get<SwineRecord>('swineRecords', id);
    if (local) {
      const updated: SwineRecord = {
        ...local,
        readyToSell,
        status: readyToSell ? 'ready_to_sell' : (local.status === 'ready_to_sell' ? 'healthy' : local.status),
        estimatedPricePhp: priceEstimate !== undefined ? priceEstimate : local.estimatedPricePhp,
        isSynced: false,
        updatedAt: new Date().toISOString(),
      };
      await indexedDbService.put('swineRecords', updated);
      await indexedDbService.enqueueSyncItem('sell', 'swine', id, { readyToSell, priceEstimate }, 2);

      const currentList = storageService.getSwineRecords();
      const updatedList = currentList.map(s => (s.id === id ? updated : s));
      storageService.saveSwineRecords(updatedList);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('swine_records_updated', { detail: updatedList }));
      }
    }
    this.checkConnectivityAndAutoSync('swine_sell');
  }

  public async queueMediaUpload(media: OfflineMediaRecord): Promise<void> {
    await indexedDbService.put('media', media);
    await indexedDbService.enqueueSyncItem('upload_media', 'media', media.id, media, 1);
    this.checkConnectivityAndAutoSync('media_upload');
  }

  public async queueCertificate(cert: IssuedCertificate): Promise<void> {
    const certId = cert.id || cert.certificateNo;
    const certToSave = { ...cert, id: certId };
    await indexedDbService.put('certificates', certToSave);
    await indexedDbService.enqueueSyncItem('create', 'certificate', certId, certToSave, 2);
    this.checkConnectivityAndAutoSync('certificate_create');
  }

  public async queueMessage(msg: MessageItem): Promise<void> {
    await indexedDbService.put('messages', msg);
    await indexedDbService.enqueueSyncItem('create', 'message', msg.id, msg, 3);
    this.checkConnectivityAndAutoSync('message_create');
  }
}

export const offlineSyncEngine = new OfflineSyncEngine(); 