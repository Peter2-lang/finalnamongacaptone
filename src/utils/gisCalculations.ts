import { hasValidGisLocation } from './gisLocation';
export { hasValidGisLocation, findBarangayContainingPoint } from './gisLocation';
import { SwineRecord, Barangay, ASFZone } from '../types';
import { HINUNANGAN_BARANGAYS } from '../data/barangays';
import { scaleSequential } from 'd3-scale';
import { interpolateRgbBasis } from 'd3-interpolate';

export type PopulationClass = 'very_low' | 'low' | 'moderate' | 'high';

export const POPULATION_CLASS_COLORS: Record<PopulationClass, string> = {
  high: '#dc2626',
  moderate: '#eab308',
  low: '#8b5cf6',
  very_low: '#22c55e',
};

const populationClassIntensity: Record<PopulationClass, number> = {
  very_low: 0.1,
  low: 0.4,
  moderate: 0.7,
  high: 1,
};

export type HeatmapMode =
  | 'swine_density'
  | 'farmer_density'
  | 'ready_to_sell'
  | 'breeding_boar'
  | 'registry_activity';

export interface HeatmapPoint {
  lat: number;
  lng: number;
  intensity: number; // 0.0 to 1.0 normalized
  rawCount: number;
  label: string;
  barangay: string;
  populationClass: PopulationClass;
}

export interface BarangayGisMetrics {
  barangayName: string;
  barangayId: string;
  riskLevel: 'green' | 'yellow' | 'red';
  asfZone: ASFZone;
  latitude: number;
  longitude: number;
  registeredFarmers: number;
  totalSwine: number;
  totalRegisteredSwine: number;
  activeSwine: number;
  farmsWithGps: number;
  registrationActivity: number;
  populationClass: PopulationClass;
  breedingBoars: number;
  breedingSows: number;
  piglets: number;
  growers: number;
  fatteners: number;
  readyForSale: number;
  swineWithGps: number;
  swineWithoutGps: number;
  focalPersonName?: string;
  contactNumber?: string;
  swineRecords: SwineRecord[];
}

export type SwineHeatmapClass = 'piglet' | 'grower' | 'finisher' | 'sow' | 'boar';

const normalizeSwineClass = (value: unknown): SwineHeatmapClass | null => {
  const type = String(value ?? '').trim().toLowerCase().replace(/[ _-]+/g, ' ');
  if (type.includes('piglet')) return 'piglet';
  if (type.includes('grower')) return 'grower';
  if (type.includes('finisher') || type.includes('fattener') || type.includes('fatten')) return 'finisher';
  if (type.includes('sow')) return 'sow';
  if (type.includes('boar')) return 'boar';
  return null;
};

/** Apply GIS classification selections once per record to avoid overlapping counts. */
export function filterSwineForHeatmap(
  swineList: SwineRecord[],
  selectedClasses: SwineHeatmapClass[] | null,
  readyToSellOnly: boolean,
): SwineRecord[] {
  const selected = new Set(selectedClasses ?? []);
  return swineList.filter(sw => {
    const status = String(sw.status || '').trim().toLowerCase().replace(/[ -]+/g, '_');
    if (sw.isArchived || status === 'sold' || status === 'deceased') return false;
    if (readyToSellOnly && !(sw.readyToSell || status === 'ready_to_sell')) return false;
    if (selectedClasses !== null && !selected.has(normalizeSwineClass(sw.swineType) as SwineHeatmapClass)) return false;
    return true;
  });
}

/**
 * Filter swine records strictly by focal person authorization if applicable
 */
export function filterSwineByAuthorization(
  swineList: SwineRecord[],
  role: string | undefined,
  assignedBarangay: string | undefined
): SwineRecord[] {
  if (role === 'landing' || !role) return [];
  if (role === 'agent') return swineList.filter(s => {
    const status = String(s.status || '').trim().toLowerCase().replace(/[ -]+/g, '_');
    return (s.readyToSell === true || status === 'ready_to_sell') && !s.isArchived && status !== 'sold' && status !== 'deceased';
  });
  if (role === 'focal') {
    const target = assignedBarangay?.trim().toLowerCase();
    if (!target) return [];
    return swineList.filter(s => (s.barangay || '').trim().toLowerCase() === target);
  }
  return swineList;
}

/**
 * Compute comprehensive GIS metrics for barangays based on current Swine Records
 */
export function computeBarangayGisMetrics(
  barangays: Barangay[],
  swineList: SwineRecord[],
  authorizedBarangay?: string
): BarangayGisMetrics[] {
  const targetList = authorizedBarangay
    ? HINUNANGAN_BARANGAYS.filter(b => b.name.toLowerCase() === authorizedBarangay.toLowerCase())
    : HINUNANGAN_BARANGAYS;

  const metrics = targetList.map(geo => {
    const liveBg = barangays.find(b => b.name.toLowerCase() === geo.name.toLowerCase());
    const registered = swineList.filter(s => (s.barangay || '').trim().toLowerCase() === geo.name.toLowerCase());
    const bgSwine = registered.filter(s => {
      const status = String(s.status || '').trim().toLowerCase().replace(/[ -]+/g, '_');
      return (s.barangay || '').trim().toLowerCase() === geo.name.toLowerCase() &&
        !s.isArchived && status !== 'sold' && status !== 'deceased';
    });

    const farmersSet = new Set(
      bgSwine.map(s => (s.farmerId || s.farmerContact || s.farmerName || '').trim().toLowerCase()).filter(Boolean)
    );

    const boars = bgSwine.filter(s => normalizeSwineClass(s.swineType) === 'boar').length;
    const sows = bgSwine.filter(s => normalizeSwineClass(s.swineType) === 'sow').length;
    const piglets = bgSwine.filter(s => normalizeSwineClass(s.swineType) === 'piglet').length;
    const growers = bgSwine.filter(s => normalizeSwineClass(s.swineType) === 'grower').length;
    const fatteners = bgSwine.filter(s => normalizeSwineClass(s.swineType) === 'finisher').length;
    const readyForSale = bgSwine.filter(s => s.readyToSell || s.status === 'ready_to_sell').length;

    const withGps = bgSwine.filter(s => hasValidGisLocation(s)).length;
    const withoutGps = bgSwine.length - withGps;

    const riskLevel = (liveBg?.riskLevel || geo.defaultRiskLevel) as 'green' | 'yellow' | 'red';
    const asfZone: ASFZone = riskLevel === 'red' ? 'RED' : riskLevel === 'yellow' ? 'YELLOW' : 'GREEN';

    return {
      barangayName: geo.name,
      barangayId: geo.id,
      riskLevel,
      asfZone,
      latitude: geo.latitude,
      longitude: geo.longitude,
      registeredFarmers: farmersSet.size,
      totalSwine: bgSwine.length,
      totalRegisteredSwine: registered.length,
      activeSwine: bgSwine.length,
      farmsWithGps: new Set(bgSwine.filter(hasValidGisLocation).map(s => s.farmerId || `${s.farmerContact || s.farmerName}:${s.latitude}:${s.longitude}`)).size,
      registrationActivity: registered.filter(s => {
        const registeredAt = Date.parse(s.registeredAt);
        const age = Date.now() - registeredAt;
        return Number.isFinite(registeredAt) && age >= 0 && age <= 30 * 86400000;
      }).length,
      populationClass: 'very_low' as PopulationClass,
      breedingBoars: boars,
      breedingSows: sows,
      piglets,
      growers,
      fatteners,
      readyForSale,
      swineWithGps: withGps,
      swineWithoutGps: withoutGps,
      focalPersonName: liveBg?.focalPersonName || geo.focalPersonName,
      contactNumber: liveBg?.contactNumber || geo.contactNumber,
      swineRecords: bgSwine,
    };
  });

  return metrics.map(metric => {
    if (metric.totalSwine === 0) return metric;

    let populationClass: PopulationClass;
    if (metric.totalSwine <= 10) {
      populationClass = 'very_low';
    } else if (metric.totalSwine <= 30) {
      populationClass = 'low';
    } else if (metric.totalSwine <= 60) {
      populationClass = 'moderate';
    } else {
      populationClass = 'high';
    }

    return { ...metric, populationClass };
  });
}

/**
 * Generates heatmap data points from actual database records
 */
export function generateHeatmapPoints(
  metrics: BarangayGisMetrics[],
  mode: HeatmapMode
): { points: HeatmapPoint[]; maxVal: number; minVal: number } {
  const points: HeatmapPoint[] = [];
  let maxVal = 0;
  let minVal = Infinity;

  // 1. Calculate raw values for each barangay
  metrics.forEach(m => {
    let raw = 0;
    switch (mode) {
      case 'swine_density':
        raw = m.totalSwine;
        break;
      case 'farmer_density':
        raw = m.registeredFarmers;
        break;
      case 'ready_to_sell':
        raw = m.readyForSale;
        break;
      case 'breeding_boar':
        raw = m.breedingBoars;
        break;
      case 'registry_activity':
        raw = m.registrationActivity;
        break;
    }

    if (raw > maxVal) maxVal = raw;
    if (raw < minVal) minVal = raw;
  });

  if (minVal === Infinity) minVal = 0;


  // 2. Plot actual farm coordinates; aggregate only records without GPS at barangay level.
  metrics.forEach(m => {
    let raw = 0;
    switch (mode) {
      case 'swine_density':
        raw = m.totalSwine;
        break;
      case 'farmer_density':
        raw = m.registeredFarmers;
        break;
      case 'ready_to_sell':
        raw = m.readyForSale;
        break;
      case 'breeding_boar':
        raw = m.breedingBoars;
        break;
      case 'registry_activity':
        raw = m.registrationActivity;
        break;
    }

    const populationClass = m.populationClass;
    if (raw <= 0) return;
    const intensity = mode === 'swine_density'
      ? populationClassIntensity[populationClass]
      : Math.max(0.1, Math.min(1.0, raw / maxVal));

    const eligible = m.swineRecords.filter(s => {
      if (mode === 'ready_to_sell' && !(s.readyToSell || s.status === 'ready_to_sell')) return false;
      if (mode === 'breeding_boar' && normalizeSwineClass(s.swineType) !== 'boar') return false;
      return true;
    });
    const withGps = mode === 'farmer_density' || mode === 'registry_activity'
      ? []
      : eligible.filter(s => hasValidGisLocation(s));
    const withoutGpsCount = Math.max(0, raw - withGps.length);

    if (withoutGpsCount > 0 || (mode === 'farmer_density' && withGps.length === 0)) {
      points.push({
        lat: m.latitude, lng: m.longitude, intensity, rawCount: withoutGpsCount || raw,
        label: `${m.barangayName} (${raw})`, barangay: m.barangayName, populationClass,
      });
    }

    withGps.forEach(s => {
      points.push({
        lat: s.latitude!, lng: s.longitude!, intensity, rawCount: 1,
        label: `${s.pigIdTag || s.earTagNo} - ${s.farmerName}`,
        barangay: s.barangay, populationClass,
      });
    });
  });

  return { points, maxVal, minVal };
}

// D3 sequential color scale interpolator for swine density heatmap
const densityColorScale = scaleSequential(
  interpolateRgbBasis(['#10b981', '#34d399', '#facc15', '#fb923c', '#dc2626'])
).domain([0, 1]);

/**
 * Get color gradient for heatmap intensity (0.0 to 1.0) using d3-scale interpolation
 */
export function getHeatmapColor(intensity: number, opacity: number = 0.5): string {
  const clamped = Math.max(0, Math.min(1, intensity));
  const rgbColor = densityColorScale(clamped);
  // Convert rgb/hex to rgba string with specified opacity
  if (rgbColor.startsWith('rgb(')) {
    return rgbColor.replace('rgb(', 'rgba(').replace(')', `, ${opacity})`);
  }

  // If hex or rgb, let's parse or return with opacity or fallback
  return rgbColor;
}

export function getPopulationClassColor(populationClass: PopulationClass): string {
  return POPULATION_CLASS_COLORS[populationClass];
}
