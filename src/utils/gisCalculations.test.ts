import {
  filterSwineByAuthorization,
  computeBarangayGisMetrics,
  generateHeatmapPoints,
  getHeatmapColor,
  filterSwineForHeatmap,
  findBarangayContainingPoint,
  HeatmapMode,
} from './gisCalculations';
import { SwineRecord, Barangay } from '../types';
import { HINUNANGAN_BARANGAYS } from '../data/barangays';
const defaultBio = {
  perimeterFence: true,
  footbathInstalled: true,
  disinfectionRoutine: true,
  quarantinePenAvailable: true,
  potableWaterSource: true,
  standardFeedStorage: true,
  asfVaccinationOrTesting: true,
  noSwillFeeding: true,
  visitorLogbook: true,
  wasteLagoonOrCompost: true,
};

const mockTestSwineRecords: SwineRecord[] = [
  {
    id: 'test-swine-1',
    pigIdTag: 'HIN-2026-0001',
    earTagNo: 'HIN-2026-0001',
    farmerName: 'Juan Dela Cruz',
    farmerContact: '9171234567',
    farmerAddress: 'Brgy. Ambacon, Hinunangan',
    barangay: 'Ambacon',
    farmType: 'backyard',
    farmScale: 'BACKYARD',
    asfZone: 'GREEN',
    swineType: 'grower',
    breed: 'Large White',
    ageWeeks: 12,
    ageDays: 84,
    ageMonths: 2.8,
    birthDate: '2026-07-01',
    weightKg: 40,
    gender: 'male',
    latitude: 10.396944,
    longitude: 125.199994,
    status: 'healthy',
    readyToSell: true,
    isArchived: false,
    biosecurity: defaultBio,
    registeredBy: 'Juan Dela Cruz (Focal)',
    registeredAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
  },
  {
    id: 'test-swine-2',
    pigIdTag: 'HIN-2026-0002',
    earTagNo: 'HIN-2026-0002',
    farmerName: 'Pedro Santos',
    farmerContact: '9181234567',
    farmerAddress: 'Brgy. Ambacon, Hinunangan',
    barangay: 'Ambacon',
    farmType: 'backyard',
    farmScale: 'BACKYARD',
    asfZone: 'GREEN',
    swineType: 'boar',
    breed: 'Duroc',
    ageWeeks: 20,
    ageDays: 140,
    ageMonths: 4.6,
    birthDate: '2026-05-01',
    weightKg: 80,
    gender: 'male',
    latitude: 0,
    longitude: 0,
    status: 'healthy',
    readyToSell: false,
    isArchived: false,
    biosecurity: defaultBio,
    registeredBy: 'Juan Dela Cruz (Focal)',
    registeredAt: '2026-08-02T08:00:00Z',
    updatedAt: '2026-08-02T08:00:00Z',
  },
  {
    id: 'test-swine-3',
    pigIdTag: 'HIN-2026-0003',
    earTagNo: 'HIN-2026-0003',
    farmerName: 'Maria Cruz',
    farmerContact: '9191234567',
    farmerAddress: 'Brgy. Biasong, Hinunangan',
    barangay: 'Biasong',
    farmType: 'backyard',
    farmScale: 'BACKYARD',
    asfZone: 'GREEN',
    swineType: 'sow',
    breed: 'Landrace',
    ageWeeks: 30,
    ageDays: 210,
    ageMonths: 7.0,
    birthDate: '2026-03-01',
    weightKg: 120,
    gender: 'female',
    latitude: 10.374407,
    longitude: 125.2135,
    status: 'healthy',
    readyToSell: false,
    isArchived: false,
    biosecurity: defaultBio,
    registeredBy: 'Maria Santos (Focal)',
    registeredAt: '2026-08-03T08:00:00Z',
    updatedAt: '2026-08-03T08:00:00Z',
  },
];

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${message}`);
}

console.log('\n--- TESTING GIS CALCULATIONS & SECURITY AUTHORIZATION ---\n');

// Mock barangays
const mockBarangays: Barangay[] = HINUNANGAN_BARANGAYS.map(b => ({
  id: b.id,
  name: b.name,
  code: b.id,
  riskLevel: b.defaultRiskLevel as any,
  latitude: b.latitude,
  longitude: b.longitude,
  focalPerson: b.focalPersonName,
  contactNumber: b.contactNumber,
}));

// Test 1: Focal Person Security Authorization
console.log('1. Testing Focal Person Authorization Filter:');
const ambaconPigs = filterSwineByAuthorization(mockTestSwineRecords, 'focal', 'Ambacon');
assert(ambaconPigs.length > 0, 'Ambacon focal person receives Ambacon swine records');
assert(
  ambaconPigs.every(s => s.barangay.toLowerCase() === 'ambacon'),
  'Ambacon focal person receives ZERO swine records from other barangays'
);

const adminPigs = filterSwineByAuthorization(mockTestSwineRecords, 'admin', undefined);
assert(
  adminPigs.length === mockTestSwineRecords.length,
  'Admin receives swine records for all barangays'
);

// Test 2: computeBarangayGisMetrics
console.log('\n2. Testing Barangay GIS Metrics Computation:');
const allMetrics = computeBarangayGisMetrics(mockBarangays, mockTestSwineRecords);
assert(allMetrics.length === 40, 'Computes metrics for all 40 Hinunangan barangays');

const ambaconMetric = allMetrics.find(m => m.barangayName.toLowerCase() === 'ambacon');
assert(!!ambaconMetric, 'Found Ambacon metric');
if (ambaconMetric) {
  assert(ambaconMetric.totalSwine > 0, `Ambacon total swine count > 0 (${ambaconMetric.totalSwine})`);
  assert(ambaconMetric.registeredFarmers > 0, `Ambacon registered farmers count > 0 (${ambaconMetric.registeredFarmers})`);
  assert(
    ambaconMetric.swineWithGps + ambaconMetric.swineWithoutGps === ambaconMetric.totalSwine,
    'GPS + Non-GPS records sum up exactly to total swine count'
  );
  assert(
    ambaconMetric.swineWithoutGps > 0,
    `Ambacon has non-GPS swine correctly associated with polygon (${ambaconMetric.swineWithoutGps})`
  );
  assert(
    ambaconMetric.populationClass === 'very_low',
    'Population category follows the configured low-count range for registered swine'
  );
}
assert(
  allMetrics.find(metric => metric.barangayName === 'Biasong')?.populationClass === 'very_low',
  'Barangays with no registered swine use the very-low population class'
);

// Test 3: Focal Restricted Metrics
console.log('\n3. Testing Restricted Focal Metrics:');
const focalMetrics = computeBarangayGisMetrics(mockBarangays, mockTestSwineRecords, 'Ambacon');
assert(focalMetrics.length === 1, 'Focal person metrics restricted to exactly 1 assigned barangay');
assert(
  focalMetrics[0].barangayName === 'Ambacon',
  'Focal person metric is exclusively for Ambacon'
);

// Test 4: Heatmap Generation for all 5 modes
console.log('\n4. Testing Dynamic Heatmap Generation (5 Modes):');
const modes: HeatmapMode[] = [
  'swine_density',
  'farmer_density',
  'ready_to_sell',
  'breeding_boar',
  'registry_activity',
];

modes.forEach(mode => {
  const activityMetrics = computeBarangayGisMetrics(mockBarangays, mockTestSwineRecords.map(s => ({...s, registeredAt: new Date().toISOString()})));
  const result = generateHeatmapPoints(mode === 'registry_activity' ? activityMetrics : allMetrics, mode);
  assert(result.points.length > 0, `Heatmap points generated for mode: ${mode}`);
  assert(result.maxVal >= 0, `Heatmap maxVal calculated for ${mode}: ${result.maxVal}`);
  assert(
    result.points.every(p => p.intensity >= 0 && p.intensity <= 1),
    `All intensity values normalized between 0 and 1 for ${mode}`
  );
});

// Test 5: Color Ramp Integrity
console.log('\n5. Testing Heatmap Color Interpolation:');
const lowColor = getHeatmapColor(0.1);
const midColor = getHeatmapColor(0.4);
const highColor = getHeatmapColor(0.85);

assert(lowColor.startsWith('rgba('), 'Low intensity renders rgba color');
assert(midColor.startsWith('rgba('), 'Medium intensity renders rgba color');
assert(highColor.startsWith('rgba('), 'High intensity renders rgba color');

assert(filterSwineByAuthorization(mockTestSwineRecords, 'focal', undefined).length === 0,
  'An unassigned focal person receives no GIS records');
assert(filterSwineByAuthorization([
  ...mockTestSwineRecords,
  {...mockTestSwineRecords[0], id: 'missing-barangay', barangay: ''},
], 'focal', '   ').length === 0,
  'A blank focal assignment cannot expose records with a missing barangay');
assert(filterSwineByAuthorization([
  {...mockTestSwineRecords[0], readyToSell: true, isArchived: false},
  {...mockTestSwineRecords[0], readyToSell: false, isArchived: false},
  {...mockTestSwineRecords[0], readyToSell: true, isArchived: true},
], 'agent', undefined).length === 1,
  'Agents receive only ready, nonarchived GIS records');

assert(findBarangayContainingPoint(10.401804141, 125.18452409) === 'Ambacon',
  'Official polygon lookup resolves a coordinate within Ambacon');
assert(findBarangayContainingPoint(0, 0) === undefined,
  'Coordinates outside all configured barangay boundaries are rejected');
const classificationRecords = [
  {...mockTestSwineRecords[0], id: 'class-piglet', swineType: 'PIGLET', status: 'healthy', readyToSell: false, isArchived: false},
  {...mockTestSwineRecords[0], id: 'class-grower', swineType: 'fatten_grower', status: 'healthy', readyToSell: true, isArchived: false},
  {...mockTestSwineRecords[0], id: 'class-sold', swineType: 'piglet', status: 'sold', readyToSell: false, isArchived: false},
  {...mockTestSwineRecords[0], id: 'class-archived', swineType: 'boar', status: 'healthy', readyToSell: false, isArchived: true},
] as SwineRecord[];
assert(filterSwineForHeatmap(classificationRecords, ['piglet'], false).map(r => r.id).join() === 'class-piglet',
  'Piglet heatmap excludes sold and archived rows');
assert(filterSwineForHeatmap(classificationRecords, null, true).map(r => r.id).join() === 'class-grower',
  'Ready-to-sell heatmap uses actual ready status and active records');
assert(computeBarangayGisMetrics([], Array.from({length: 11}, (_, index) => ({
  ...mockTestSwineRecords[0], id: `range-${index}`, barangay: 'Ambacon', status: 'healthy', isArchived: false,
}))).find(metric => metric.barangayName === 'Ambacon')?.populationClass === 'low',
  'Eleven active swine are classified in the 11–30 intensity band');
assert(generateHeatmapPoints(computeBarangayGisMetrics([], []), 'swine_density').points.length === 0,
  'Zero-record barangays do not create artificial heatmap hotspots');

console.log('\n🎉 ALL GIS MAP AND ACCESS CONTROL TESTS PASSED SUCCESSFULLY!\n');
