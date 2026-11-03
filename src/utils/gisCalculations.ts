import { SwineRecord, Barangay, ASFZone } from '../types';
import { HINUNANGAN_BARANGAYS, HinunanganBarangayGeo } from '../data/barangays';
import { HINUNANGAN_BARANGAY_BOUNDARIES } from '../data/hinunanganBoundariesGeoJSON';
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

/**
 * Filter swine records strictly by focal person authorization if applicable
 */
export function filterSwineByAuthorization(
  swineList: SwineRecord[],
  role: string | undefined,
  assignedBarangay: string | undefined
): SwineRecord[] {
  if (role === 'focal' && assignedBarangay) {
    const target = assignedBarangay.trim().toLowerCase();
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
    const bgSwine = swineList.filter(
      s => (s.barangay || '').trim().toLowerCase() === geo.name.toLowerCase() && !s.isArchived
    );

    const farmersSet = new Set(
      bgSwine.map(s => (s.farmerName || s.farmerContact || '').trim().toLowerCase()).filter(Boolean)
    );

    const boars = bgSwine.filter(s => s.swineType === 'boar').length;
    const sows = bgSwine.filter(s => s.swineType === 'sow').length;
    const piglets = bgSwine.filter(s => s.swineType === 'piglet').length;
    const growers = bgSwine.filter(s => s.swineType === 'grower').length;
    const fatteners = bgSwine.filter(s => s.swineType === 'finisher').length;
    const readyForSale = bgSwine.filter(s => s.readyToSell || s.status === 'ready_to_sell').length;

    const withGps = bgSwine.filter(s => typeof s.latitude === 'number' && typeof s.longitude === 'number' && s.latitude > 0 && s.longitude > 0).length;
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

  const populationGroups = metrics
    .map(metric => metric.totalSwine)
    .filter(count => count > 0)
    .sort((a, b) => a - b);
  const quantile = (fraction: number): number => {
    if (populationGroups.length === 0) return 0;
    const position = (populationGroups.length - 1) * fraction;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const range = populationGroups[upperIndex] - populationGroups[lowerIndex];
    return populationGroups[lowerIndex] + range * (position - lowerIndex);
  };
  const [lowerThreshold, middleThreshold, upperThreshold] = [0.25, 0.5, 0.75].map(quantile);
  const distinctPopulations = new Set(populationGroups).size;

  return metrics.map(metric => {
    if (metric.totalSwine === 0) return metric;

    let populationClass: PopulationClass;
    if (distinctPopulations === 1) {
      populationClass = 'moderate';
    } else if (metric.totalSwine <= lowerThreshold) {
      populationClass = 'very_low';
    } else if (metric.totalSwine <= middleThreshold) {
      populationClass = 'low';
    } else if (metric.totalSwine <= upperThreshold) {
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
        raw = m.totalSwine + m.readyForSale * 1.5 + m.registeredFarmers * 2;
        break;
    }

    if (raw > maxVal) maxVal = raw;
    if (raw < minVal) minVal = raw;
  });

  if (minVal === Infinity) minVal = 0;
  if (maxVal === 0) maxVal = 1;

  // 2. Build heatmap points from swine records with coordinates + centroid fallback
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
        raw = m.totalSwine + m.readyForSale * 1.5 + m.registeredFarmers * 2;
        break;
    }

    const populationClass = m.populationClass;
    const intensity = mode === 'swine_density'
      ? populationClassIntensity[populationClass]
      : Math.max(0.1, Math.min(1.0, raw / maxVal));

    // Centroid point representing barangay aggregated density
    points.push({
      lat: m.latitude,
      lng: m.longitude,
      intensity,
      rawCount: raw,
      label: `${m.barangayName} (${raw})`,
      barangay: m.barangayName,
      populationClass,
    });

    if (mode === 'swine_density') return;

    // Also include specific swine coordinates if available
    m.swineRecords.forEach(s => {
      if (s.latitude && s.longitude && s.latitude > 0 && s.longitude > 0) {
        let swineWeight = 1;
        if (mode === 'ready_to_sell' && !s.readyToSell && s.status !== 'ready_to_sell') return;
        if (mode === 'breeding_boar' && s.swineType !== 'boar') return;
        if (mode === 'ready_to_sell') swineWeight = 2;
        if (mode === 'breeding_boar') swineWeight = 2.5;

        points.push({
          lat: s.latitude,
          lng: s.longitude,
          intensity: Math.min(1.0, (swineWeight / (maxVal || 1)) * 1.5),
          rawCount: swineWeight,
          label: `${s.pigIdTag || s.earTagNo} - ${s.farmerName}`,
          barangay: s.barangay,
          populationClass,
        });
      }
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
