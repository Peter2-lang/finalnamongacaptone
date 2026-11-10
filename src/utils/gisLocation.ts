import type { SwineRecord } from '../types';
import { HINUNANGAN_BARANGAY_BOUNDARIES } from '../data/hinunanganBoundariesGeoJSON';

/** A verified map location requires finite coordinates inside a configured polygon. */
export function hasValidGisLocation(record: Pick<SwineRecord, 'latitude' | 'longitude'>): boolean {
  return typeof record.latitude === 'number' && typeof record.longitude === 'number' &&
    Number.isFinite(record.latitude) && Number.isFinite(record.longitude) &&
    !!findBarangayContainingPoint(record.latitude, record.longitude);
}

/** Return the configured barangay polygon containing a Hinunangan coordinate. */
export function findBarangayContainingPoint(lat: number, lng: number): string | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  for (const [name, points] of Object.entries(HINUNANGAN_BARANGAY_BOUNDARIES)) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [yi, xi] = points[i];
      const [yj, xj] = points[j];
      const crosses = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
    if (inside) return name;
  }
  return undefined;
}

