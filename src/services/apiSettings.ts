import { useEffect, useState } from 'react';
import { requestJson } from './http.ts';

export interface ApiSettings {
  apiBaseUrl: string;
  googleMapsKey: string;
  tileServerUrl: string;
  satelliteTileUrl: string;
  quotaDefenseEnabled: boolean;
}
const defaults: ApiSettings = {
  apiBaseUrl: typeof location === 'undefined' ? '' : location.origin,
  googleMapsKey: import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || '',
  tileServerUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  satelliteTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  quotaDefenseEnabled: true,
};
let snapshot = defaults;
const listeners = new Set<(settings: ApiSettings) => void>();
export async function loadApiSettings(): Promise<ApiSettings> {
  const result = await requestJson<{ value: Partial<ApiSettings> | null }>('/api/settings?key=api_configuration');
  snapshot = { ...defaults, ...result.value, googleMapsKey: result.value?.googleMapsKey || defaults.googleMapsKey };
  listeners.forEach(listener => listener(snapshot));
  return snapshot;
}
export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  if (new URL(settings.apiBaseUrl).origin !== location.origin) throw new Error('This deployment uses its own API origin. Configure external proxying on the server.');
  for (const url of [settings.tileServerUrl, settings.satelliteTileUrl]) if (!url.startsWith('https://') || !['{z}', '{x}', '{y}'].every(part => url.includes(part))) throw new Error('Tile URLs must use HTTPS and contain {z}, {x} and {y}.');
  await requestJson('/api/settings', { method: 'PUT', body: JSON.stringify({ key: 'api_configuration', value: settings }) });
  snapshot = settings;
  listeners.forEach(listener => listener(snapshot));
}
export function useApiSettings() {
  const [settings, setSettings] = useState(snapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listeners.add(setSettings);
    loadApiSettings().catch(failure => setError(failure instanceof Error ? failure.message : 'Unable to load map configuration.')).finally(() => setLoading(false));
    return () => { listeners.delete(setSettings); };
  }, []);
  return { settings, error, loading };
}
