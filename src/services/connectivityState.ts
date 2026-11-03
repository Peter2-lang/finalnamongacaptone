export type ConnectivityState = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNCED' | 'ERROR';

export function getConnectivityState(options: {
  browserOnline: boolean;
  simulatedOffline: boolean;
  backendReachable: boolean;
  syncing: boolean;
  state: ConnectivityState;
}): { isOnline: boolean; state: ConnectivityState } {
  const isOnline = options.browserOnline && !options.simulatedOffline;
  return {
    isOnline,
    state: !isOnline ? 'OFFLINE' : options.syncing ? 'SYNCING' : !options.backendReachable ? 'ERROR' : options.state,
  };
}
