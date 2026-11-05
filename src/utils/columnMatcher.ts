import { coerceImportValue, validIsoDate } from './swineImportData';
import * as XLSX from 'xlsx';
import {
  Barangay,
  ImportColumnMapping,
  ImportMatchStatus,
  ImportRowValidationError,
  ImportRowValidationResult,
  RegistryFormField,
  RegistryFormSchema,
  RegistryFieldType,
  SwineRecord,
  SwineType,
  FarmScale,
  ASFZone,
} from '../types';
import { getFieldKey, toFieldKey } from './registryFieldUtils';
import {
  calculateSwineAge,
  classifyFarmScale,
  getBarangayASFZone,
  getEstimatedWeightRange,
  isValidPigIdTag,
} from './swineRegistryLogic';
import { isPointInsideHinunangan } from './boundaryValidation';

export const PIG_ID_TAG_REGEX = /^HIN-\d{4}-\d{4,}$/;

/**
 * SQL & Javascript Reserved Keywords whitelist for field keys
 */
const RESERVED_KEYWORDS = new Set([
  'select', 'table', 'from', 'where', 'insert', 'update', 'delete', 'drop',
  'alter', 'create', 'order', 'group', 'by', 'limit', 'offset', 'join',
  'inner', 'left', 'right', 'outer', 'on', 'as', 'distinct', 'union',
  'case', 'when', 'then', 'else', 'end', 'null', 'not', 'and', 'or',
  'user', 'users', 'status', 'type', 'id', 'primary', 'key', 'default',
  'index', 'values', 'into', 'set', 'view', 'database', 'schema',
]);

/**
 * Core Field Definition Item
 */
export interface CoreFieldDef {
  key: string;
  label: string;
  labelEn: string;
  labelCeb: string;
  labelFil: string;
  aliases: string[];
  type: RegistryFieldType;
  required: boolean;
  helpText: string;
}

/**
 * Authoritative Core Swine Registry Fields definition with extensive aliases
 */
export const CORE_SWINE_FIELDS: CoreFieldDef[] = [
  ...[
    { key: 'age_months', label: 'Age (months)', aliases: ['age', 'age months', 'age_months', 'ageMonths'], type: 'number' },
    { key: 'farmer_id', label: 'Farmer Reference ID', aliases: ['farmer_id', 'farmerId'], type: 'text' },
    { key: 'record_id', label: 'Existing Record ID', aliases: ['id', 'record_id'], type: 'text' },
    { key: 'status', label: 'Health Status', aliases: ['status', 'health_status'], type: 'text' },
  ].map(field => ({...field, type: field.type as RegistryFieldType, labelEn: field.label, labelCeb: field.label, labelFil: field.label, required: false, helpText: field.label})),

  {
    key: 'pig_id_tag',
    label: 'Pig ID Tag',
    labelEn: 'Pig ID Tag',
    labelCeb: 'Pig ID Tag',
    labelFil: 'Pig ID Tag',
    aliases: [
      'pig id', 'pig id tag', 'pig_id_tag', 'pig_id', 'pigid', 'tag id',
      'ear tag', 'ear tag no', 'ear tag number', 'eartag', 'eartagno', 'tag',
      'computed_pig_id', 'id tag', 'swine id', 'animal id', 'id', 'pig code'
    ],
    type: 'text',
    required: false,
    helpText: 'Official municipal tag ID formatted as HIN-YYYY-XXXX',
  },
  {
    key: 'farmer_name',
    label: 'Farmer / Raiser Name',
    labelEn: 'Farmer / Raiser Name',
    labelCeb: 'Ngalan sa Mag-uuma / Raiser',
    labelFil: 'Pangalan ng Magsasaka / Raiser',
    aliases: [
      'farmer name', 'farmer', 'raiser', 'owner', 'farmer_name', 'farmer full name',
      'raiser name', 'pet owner', 'breeder', 'producer', 'hog raiser', 'full name',
      'pangalan', 'ngalan'
    ],
    type: 'text',
    required: true,
    helpText: 'Full legal name of the swine raiser/farmer',
  },
  {
    key: 'barangay',
    label: 'Barangay Location',
    labelEn: 'Barangay Location',
    labelCeb: 'Nahimutangan nga Barangay',
    labelFil: 'Lokasyon ng Barangay',
    aliases: [
      'barangay', 'brgy', 'bgy', 'location', 'assigned barangay',
      'barangay location', 'village', 'lokasyon'
    ],
    type: 'barangay_select',
    required: true,
    helpText: 'One of the 40 official Hinunangan Barangays',
  },
  {
    key: 'farmer_contact',
    label: 'Farmer Contact Number',
    labelEn: 'Farmer Contact Number',
    labelCeb: 'Numero sa Telepono sa Mag-uuma',
    labelFil: 'Numero ng Telepono ng Magsasaka',
    aliases: [
      'contact', 'farmer contact', 'contact number', 'phone', 'cellphone',
      'mobile', 'mobile number', 'tel', 'telephone', 'farmer_contact',
      'contact_number', 'phone number', 'numero'
    ],
    type: 'phone',
    required: false,
    helpText: '10-digit Philippine mobile number starting with 9',
  },
  {
    key: 'farm_name',
    label: 'Farm / Piggery Business Name',
    labelEn: 'Farm / Piggery Business Name',
    labelCeb: 'Ngalan sa Umahan o Tangkal',
    labelFil: 'Pangalan ng Sakahan o Piggery',
    aliases: [
      'farm name', 'farm', 'piggery name', 'farm_name', 'establishment',
      'farm / piggery business name', 'business name', 'piggery'
    ],
    type: 'text',
    required: false,
    helpText: 'Name of the farm or piggery operation',
  },
  {
    key: 'birth_date',
    label: 'Birth Date (Farrowing)',
    labelEn: 'Birth Date (Farrowing)',
    labelCeb: 'Petsa sa Pagpanganak / Farrowing',
    labelFil: 'Petsa ng Kapanganakan / Farrowing',
    aliases: [
      'birth date', 'birthdate', 'dob', 'date of birth', 'farrowing date',
      'farrowing', 'farrowed date', 'birth_date', 'estimated_farrowing_birth_date',
      'petsa sa natawo', 'petsa ng kapanganakan'
    ],
    type: 'date',
    required: false,
    helpText: 'Estimated or exact birth date (YYYY-MM-DD)',
  },
  {
    key: 'breed',
    label: 'Swine Breed',
    labelEn: 'Swine Breed',
    labelCeb: 'Matang / Breed sa Baboy',
    labelFil: 'Lahi / Breed ng Baboy',
    aliases: [
      'breed', 'swine breed', 'pig breed', 'genetic line', 'cross', 'variety',
      'klase sa baboy', 'lahi'
    ],
    type: 'breed_select',
    required: false,
    helpText: 'e.g. Landrace, Large White, Duroc, Native Cross',
  },
  {
    key: 'swine_type',
    label: 'Swine Category / Stage',
    labelEn: 'Swine Category / Stage',
    labelCeb: 'Kategoriya / Yugto sa Pagtubo',
    labelFil: 'Kategorya / Yugto ng Paglaki',
    aliases: [
      'swine type', 'type', 'category', 'swine category', 'stage', 'growth stage',
      'swine classification', 'classification', 'swine_type', 'swinetype'
    ],
    type: 'dropdown',
    required: false,
    helpText: 'piglet, grower, finisher, sow, boar, gilt',
  },
  {
    key: 'actual_weight_kg',
    label: 'Actual / Live Weight (kg)',
    labelEn: 'Actual / Live Weight (kg)',
    labelCeb: 'Tinuod nga Timbang (kg)',
    labelFil: 'Aktuwal na Timbang (kg)',
    aliases: [
      'actual weight', 'weight', 'weight kg', 'weight (kg)', 'actual weight (kg)',
      'live weight', 'live weight kg', 'live_weight_kg', 'actual_weight',
      'actual_weight_kg', 'kg', 'timbang'
    ],
    type: 'number',
    required: false,
    helpText: 'Measured scale weight in kilograms',
  },
  {
    key: 'gender',
    label: 'Sex / Castration Status',
    labelEn: 'Sex / Castration Status',
    labelCeb: 'Sekso / Kahimtang sa Kapon',
    labelFil: 'Kasarian / Katayuan ng Pagkakapon',
    aliases: [
      'gender', 'sex', 'gender / castration', 'castration status',
      'sex / castration', 'kasarian', 'sekso'
    ],
    type: 'dropdown',
    required: false,
    helpText: 'boar, sow, gilt, barrow, castrated, female, male',
  },
  {
    key: 'farm_scale',
    label: 'Farm Scale Classification',
    labelEn: 'Farm Scale Classification',
    labelCeb: 'Gidak-on sa Umahan',
    labelFil: 'Laki ng Sakahan',
    aliases: [
      'farm scale', 'farm type', 'scale', 'farm classification',
      'operation scale', 'classification', 'farmscale', 'farmtype'
    ],
    type: 'dropdown',
    required: false,
    helpText: 'BACKYARD, SEMI_COMMERCIAL, COMMERCIAL_MEDIUM, COMMERCIAL_LARGE',
  },
  {
    key: 'asf_zone',
    label: 'African Swine Fever (ASF) Zone',
    labelEn: 'ASF Zone Classification',
    labelCeb: 'Klase sa ASF Zone',
    labelFil: 'Klasipikasyon ng ASF Zone',
    aliases: [
      'asf zone', 'asf status', 'zoning', 'asf color', 'color zone',
      'zone', 'asf_zone', 'asfzone'
    ],
    type: 'dropdown',
    required: false,
    helpText: 'RED, PINK, YELLOW, GREEN',
  },
  {
    key: 'ready_to_sell',
    label: 'Ready for Commercial Sale / Take-off',
    labelEn: 'Ready for Commercial Sale',
    labelCeb: 'Andam na Ibaligya / Take-off',
    labelFil: 'Handa nang Ibenta / Take-off',
    aliases: [
      'ready to sell', 'ready for takeoff', 'for sale', 'market ready',
      'ready_to_sell', 'readytosell', 'sellable', 'ready', 'for slaughter'
    ],
    type: 'yes_no',
    required: false,
    helpText: 'Yes / No or True / False indicator',
  },
  {
    key: 'price_estimate',
    label: 'Estimated Market Price (PHP)',
    labelEn: 'Estimated Market Price (PHP)',
    labelCeb: 'Gibanabana nga Presyo sa Merkado (PHP)',
    labelFil: 'Tinatayang Presyo sa Pamilihan (PHP)',
    aliases: [
      'estimated price', 'price', 'market price', 'price estimate',
      'est price (php)', 'price (php)', 'valuation', 'presyo'
    ],
    type: 'number',
    required: false,
    helpText: 'Projected value in Philippine Pesos',
  },
  {
    key: 'rsbsa_id',
    label: 'RSBSA Reference Number',
    labelEn: 'RSBSA Reference Number',
    labelCeb: 'Numero sa Rehistro sa RSBSA',
    labelFil: 'Numero ng Rehistro sa RSBSA',
    aliases: [
      'rsbsa', 'rsbsa id', 'rsbsa no', 'rsbsa reference', 'rsbsa reference number',
      'rsbsa_id', 'registry system for basic sectors in agriculture'
    ],
    type: 'text',
    required: false,
    helpText: 'DA RSBSA Farmer Reference Code',
  },
  {
    key: 'latitude',
    label: 'Pen GPS Latitude',
    labelEn: 'Pen GPS Latitude',
    labelCeb: 'GPS Latitude sa Tangkal',
    labelFil: 'GPS Latitude ng Kulungan',
    aliases: ['latitude', 'lat', 'gps lat', 'gps_latitude', 'gps latitude'],
    type: 'number',
    required: false,
    helpText: 'Decimal latitude coordinate (approx 10.35 to 10.45)',
  },
  {
    key: 'longitude',
    label: 'Pen GPS Longitude',
    labelEn: 'Pen GPS Longitude',
    labelCeb: 'GPS Longitude sa Tangkal',
    labelFil: 'GPS Longitude ng Kulungan',
    aliases: ['longitude', 'long', 'lng', 'gps long', 'gps_longitude', 'gps longitude'],
    type: 'number',
    required: false,
    helpText: 'Decimal longitude coordinate (approx 125.15 to 125.26)',
  },
  {
    key: 'pen_capacity',
    label: 'Total Pen Capacity (Heads)',
    labelEn: 'Total Pen Capacity (Heads)',
    labelCeb: 'Kapasidad sa Tangkal (Ulo)',
    labelFil: 'Kapasidad ng Kulungan (Ulo)',
    aliases: [
      'pen capacity', 'capacity', 'total pen capacity', 'heads capacity',
      'pen_capacity', 'pencapacity', 'number of pens'
    ],
    type: 'number',
    required: false,
    helpText: 'Total maximum swine capacity',
  },
  {
    key: 'notes',
    label: 'Health & Vaccination Notes',
    labelEn: 'Health & Vaccination Notes',
    labelCeb: 'Mubo nga Sulat sa Panglawas ug Bakuna',
    labelFil: 'Tala sa Kalusugan at Bakuna',
    aliases: [
      'notes', 'remarks', 'health notes', 'comments', 'observations',
      'veterinary notes', 'mga nota', 'remarks'
    ],
    type: 'textarea',
    required: false,
    helpText: 'Medical observations or history',
  },
];

/**
 * Normalizes any header string for comparison
 */
export function normalizeHeader(header: string): string {
  if (!header) return '';
  return header
    .toString()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/[\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a clean, SQL-safe, collision-free field key
 */
export function generateSafeFieldKey(rawHeader: string, existingKeys: Set<string>): string {
  let clean = rawHeader
    .toString()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!clean || /^\d+$/.test(clean)) {
    clean = `custom_field_${clean || Date.now().toString().slice(-4)}`;
  }

  // Prevent starting with a number
  if (/^\d/.test(clean)) {
    clean = `fld_${clean}`;
  }

  // Truncate length
  if (clean.length > 40) {
    clean = clean.substring(0, 40);
  }

  // Reserved SQL keyword protection
  if (RESERVED_KEYWORDS.has(clean)) {
    clean = `custom_${clean}`;
  }

  // Ensure uniqueness
  let finalKey = clean;
  let counter = 1;
  while (existingKeys.has(finalKey)) {
    finalKey = `${clean}_${counter}`;
    counter++;
  }

  return finalKey;
}

/**
 * Known Agricultural & Swine Vocabulary Translation Matrix
 */
interface TranslationPair {
  matchKeywords: string[];
  en: string;
  ceb: string;
  fil: string;
  type?: RegistryFieldType;
}

const TRANSLATION_DICTIONARY: TranslationPair[] = [
  {
    matchKeywords: ['vaccin', 'bakuna', 'immunization', 'shot'],
    en: 'Vaccination Status',
    ceb: 'Kahimtang sa Bakuna',
    fil: 'Katayuan ng Bakuna',
    type: 'dropdown',
  },
  {
    matchKeywords: ['deworm', 'purga', 'parasite'],
    en: 'Last Deworming Date',
    ceb: 'Petsa sa Katapusang Pagpurga',
    fil: 'Petsa ng Huling Pagpupurga',
    type: 'date',
  },
  {
    matchKeywords: ['feed', 'tubong', 'feeding', 'ration', 'diet'],
    en: 'Feed Type & Nutrition',
    ceb: 'Matang sa Tubong ug Pagkaon',
    fil: 'Uri ng Pagkain at Nutrisyon',
    type: 'dropdown',
  },
  {
    matchKeywords: ['housing', 'tangkal', 'kulungan', 'pen type', 'enclosure'],
    en: 'Housing / Pen Structure',
    ceb: 'Klase sa Tangkal / Enclosure',
    fil: 'Uri ng Kulungan / Enclosure',
    type: 'dropdown',
  },
  {
    matchKeywords: ['mother', 'inahan', 'dam', 'inang'],
    en: 'Mother / Dam ID Tag',
    ceb: 'ID sa Inahan nga Baboy (Dam)',
    fil: 'ID ng Inang Baboy (Dam)',
    type: 'text',
  },
  {
    matchKeywords: ['father', 'amahan', 'sire', 'barako'],
    en: 'Father / Sire ID Tag',
    ceb: 'ID sa Amahan nga Baboy (Sire)',
    fil: 'ID ng Barako (Sire)',
    type: 'text',
  },
  {
    matchKeywords: ['previous owner', 'seller', 'gipalitan', 'source'],
    en: 'Previous Owner / Origin Farm',
    ceb: 'Kanhing Tag-iya / Gigikanan',
    fil: 'Dating May-ari / Pinanggalingan',
    type: 'text',
  },
  {
    matchKeywords: ['slaughter', 'ihaw', 'abattoir', 'matadero'],
    en: 'Target Slaughter Date',
    ceb: 'Target nga Petsa sa Pag-ihaw',
    fil: 'Target na Petsa ng Pagkatay',
    type: 'date',
  },
  {
    matchKeywords: ['quarantine', 'isolation', 'kwarantina'],
    en: 'Quarantine Status',
    ceb: 'Kahimtang sa Kwarantina',
    fil: 'Katayuan ng Kwarantina',
    type: 'dropdown',
  },
  {
    matchKeywords: ['water', 'tubig', 'source'],
    en: 'Water Supply Source',
    ceb: 'Tinubdan sa Tubig',
    fil: 'Pinagkukunang Tubig',
    type: 'dropdown',
  },
  {
    matchKeywords: ['waste', 'lagoon', 'tae', 'manure', 'compost', 'dumi'],
    en: 'Waste Management System',
    ceb: 'Pamaagi sa Pagdumala sa Hugaw',
    fil: 'Pamamahala ng Dumi / Basura',
    type: 'dropdown',
  },
  {
    matchKeywords: ['inspector', 'veterinarian', 'vet', 'auditor'],
    en: 'Assigned Livestock Inspector',
    ceb: 'Gitudlo nga Inspektor sa Kahayupan',
    fil: 'Itinalagang Tagasuri ng Hayop',
    type: 'text',
  },
  {
    matchKeywords: ['price', 'halin', 'benta', 'cost'],
    en: 'Commercial Valuation',
    ceb: 'Bili sa Merkado',
    fil: 'Halaga sa Pamilihan',
    type: 'number',
  },
];

/**
 * Generates automated EN, CEB, and FIL labels from an uploaded column name
 */
export function generateTranslatedLabels(rawHeader: string): {
  en: string;
  ceb: string;
  fil: string;
  suggestedType?: RegistryFieldType;
} {
  const norm = normalizeHeader(rawHeader);

  // Check against our specialized agricultural vocabulary dictionary
  for (const item of TRANSLATION_DICTIONARY) {
    if (item.matchKeywords.some(kw => norm.includes(kw))) {
      // Capitalize raw header nicely for en label if specific
      const cleanEn = rawHeader
        .split(/[_\-\s]+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      return {
        en: cleanEn || item.en,
        ceb: item.ceb,
        fil: item.fil,
        suggestedType: item.type,
      };
    }
  }

  // Format English Title Case
  const enLabel = rawHeader
    .replace(/[_\-]+/g, ' ')
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  // Automatic heuristic Bisaya / Filipino labels
  const cebLabel = `${enLabel} (Rekord sa Baboy)`;
  const filLabel = `${enLabel} (Talaan ng Baboy)`;

  return {
    en: enLabel,
    ceb: cebLabel,
    fil: filLabel,
  };
}

/**
 * Inspects sample column values to automatically detect data type
 */
export function detectDataTypeFromValues(sampleValues: any[]): {
  type: RegistryFieldType;
  options?: string[];
  warning?: string;
} {
  if (sampleValues.some(value => value !== null && typeof value === 'object' && !(value instanceof Date))) {
    return { type: 'text', warning: 'Structured JSON values detected. Values will be preserved; review the suggested Text type.' };
  }
  const nonEmpties = sampleValues.map(value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0,10) : (value ?? '').toString().trim()).filter(Boolean);
  if (nonEmpties.length === 0) {
    return { type: 'text' };
  }

  // 1. Check Boolean
  const booleanTerms = new Set(['true', 'false', 'yes', 'no', 'oo', 'dili', 'hindi', 'y', 'n']);
  const isAllBoolean = nonEmpties.every(v => booleanTerms.has(v.toLowerCase()));
  if (isAllBoolean && nonEmpties.length > 0) {
    return { type: 'checkbox' };
  }

  // 2. Check Date
  const isAllDates = nonEmpties.every(validIsoDate);
  if (isAllDates && nonEmpties.length > 0) {
    return { type: 'date' };
  }

  // 3. Check Number / Decimal
  const isAllNumeric = nonEmpties.every(v => {
    const num = Number(v.replace(/,/g, ''));
    return Number.isFinite(num) && v.trim() !== '';
  });
  if (isAllNumeric && nonEmpties.length > 0) {
    return { type: 'number' };
  }

  const families = new Set(nonEmpties.map(value => /^(true|false|yes|no)$/i.test(value) ? 'boolean' : validIsoDate(value) ? 'date' : Number.isFinite(Number(value)) ? 'number' : 'text'));
  if (families.size > 1) return { type: 'text', warning: 'Mixed data types detected. Values will be preserved; review the suggested Text type.' };

  // 4. Check Dropdown (Categorical, unique values <= 8, samples >= 3)
  const uniqueValues = Array.from(new Set(nonEmpties));
  if (uniqueValues.length >= 2 && uniqueValues.length <= 8 && nonEmpties.length >= 3) {
    // Check if string lengths are reasonable for dropdown options (< 40 chars)
    if (uniqueValues.every(u => u.length <= 40)) {
      return {
        type: 'dropdown',
        options: uniqueValues,
      };
    }
  }

  // 5. Check Long Text
  if (nonEmpties.some(v => v.length > 80)) {
    return { type: 'textarea' };
  }

  return { type: 'text' };
}

/**
 * Compares and maps uploaded headers against Core fields and Schema custom fields
 */
export function analyzeImportColumns(
  headers: string[],
  sampleRows: Record<string, any>[],
  formSchema: RegistryFormSchema
): ImportColumnMapping[] {
  const existingFieldKeys = new Set<string>();

  // Collect Core keys
  CORE_SWINE_FIELDS.forEach(cf => existingFieldKeys.add(cf.key));

  // Collect Custom schema keys
  (formSchema.sections || []).forEach(sec => {
    (sec.fields || []).forEach(fld => {
      existingFieldKeys.add(getFieldKey(fld));
      if (fld.id) existingFieldKeys.add(fld.id);
    });
  });

  const mappings: ImportColumnMapping[] = [];

  headers.forEach(rawHeader => {
    const norm = normalizeHeader(rawHeader);
    const allValues = sampleRows.map(r => r[rawHeader] ?? '');
    const sampleValues = allValues.slice(0, 30).map(value => typeof value === 'object' ? JSON.stringify(value) : String(value));
    const { type: detectedType, options: detectedOptions, warning: typeWarning } = detectDataTypeFromValues(allValues);
    const autoLabels = generateTranslatedLabels(rawHeader);

    // 1. Attempt match against Core Swine Fields
    let matchedCore: CoreFieldDef | undefined;
    for (const cf of CORE_SWINE_FIELDS) {
      if (cf.key === norm || cf.label.toLowerCase() === norm) {
        matchedCore = cf;
        break;
      }
      if (cf.aliases.some(alias => normalizeHeader(alias) === norm)) {
        matchedCore = cf;
        break;
      }
    }

    if (matchedCore) {
      mappings.push({
        fileHeader: rawHeader,
        normalizedHeader: norm,
        targetFieldKey: matchedCore.key,
        targetFieldLabel: matchedCore.label,
        matchStatus: 'matched_core',
        isNewField: false,
        detectedDataType: matchedCore.type,
        detectedOptions: detectedOptions,
        sampleValues,
        labelEn: matchedCore.labelEn,
        labelCeb: matchedCore.labelCeb,
        labelFil: matchedCore.labelFil,
        isRequired: matchedCore.required,
        createField: false,
        searchable: true,
        filterable: true,
        sortable: true,
        exportable: true,
        printable: true,
      });
      return;
    }

    // 2. Attempt match against existing Schema custom fields
    let matchedCustomField: RegistryFormField | undefined;
    (formSchema.sections || []).forEach(sec => {
      (sec.fields || []).forEach(fld => {
        const k = getFieldKey(fld);
        if (normalizeHeader(k) === norm || normalizeHeader(fld.label) === norm) {
          matchedCustomField = fld;
        }
      });
    });

    if (matchedCustomField) {
      mappings.push({
        fileHeader: rawHeader,
        normalizedHeader: norm,
        targetFieldKey: getFieldKey(matchedCustomField),
        targetFieldLabel: (matchedCustomField as RegistryFormField).label,
        matchStatus: 'matched_custom',
        isNewField: false,
        detectedDataType: (matchedCustomField as RegistryFormField).type || detectedType,
        detectedOptions: (matchedCustomField as RegistryFormField).options || detectedOptions,
        sampleValues,
        labelEn: (matchedCustomField as RegistryFormField).labelEn || (matchedCustomField as RegistryFormField).label,
        labelCeb: (matchedCustomField as RegistryFormField).labelCeb || autoLabels.ceb,
        labelFil: (matchedCustomField as RegistryFormField).labelFil || autoLabels.fil,
        isRequired: Boolean((matchedCustomField as RegistryFormField).required),
        createField: false,
        searchable: (matchedCustomField as RegistryFormField).searchable !== false,
        filterable: (matchedCustomField as RegistryFormField).filterable !== false,
        sortable: (matchedCustomField as RegistryFormField).sortable !== false,
        exportable: (matchedCustomField as RegistryFormField).exportable !== false,
        printable: (matchedCustomField as RegistryFormField).printable !== false,
      });
      return;
    }

    // 3. New Unmatched Field Detected!
    const safeKey = generateSafeFieldKey(rawHeader, existingFieldKeys);
    existingFieldKeys.add(safeKey);

    mappings.push({
      fileHeader: rawHeader,
      normalizedHeader: norm,
      targetFieldKey: safeKey,
      targetFieldLabel: autoLabels.en,
      matchStatus: 'new_field',
      isNewField: true,
      detectedDataType: detectedType,
      typeWarning,
      detectedOptions: detectedOptions,
      sampleValues,
      labelEn: autoLabels.en,
      labelCeb: autoLabels.ceb,
      labelFil: autoLabels.fil,
      isRequired: false,
      createField: true, // Default to true for new columns
      searchable: true,
      filterable: true,
      sortable: true,
      exportable: true,
      printable: true,
    });
  });

  return mappings;
}

/**
 * Validates a single imported row against Hinunangan biosecurity, core database constraints, and custom fields
 */
export function validateImportRow(
  rowNumber: number,
  rawRow: Record<string, any>,
  mappings: ImportColumnMapping[],
  barangays: Pick<Barangay, 'id' | 'name'>[],
  existingEarTags: Set<string>,
  seenBatchTags: Set<string>,
  duplicateHandling: 'update' | 'skip' | 'rename'
): ImportRowValidationResult {
  const errors: ImportRowValidationError[] = [];
  const warnings: ImportRowValidationError[] = [];
  const core: Record<string, any> = Object.create(null);
  const customFields: Record<string, any> = Object.create(null);
  const issue = (field: string, value: any, message: string, warning = false) => {
    (warning ? warnings : errors).push({ row: rowNumber, field, value, message, severity: warning ? 'warning' : 'error' });
  };
  const targets = new Set<string>();
  mappings.forEach(mapping => {
    if (mapping.matchStatus === 'ignored' || (mapping.isNewField && !mapping.createField)) return;
    if (targets.has(mapping.targetFieldKey)) issue(mapping.targetFieldKey, '', 'Multiple source columns map to the same target. Review column mappings.');
    targets.add(mapping.targetFieldKey);
    const value = rawRow[mapping.fileHeader];
    const empty = value === undefined || value === null || value === '';
    if (empty && mapping.isRequired) issue(mapping.targetFieldKey, value, `${mapping.targetFieldLabel} is required.`);
    if (empty) {
      if (mapping.matchStatus !== 'matched_core' && value === null) customFields[mapping.targetFieldKey] = null;
      return;
    }
    try {
      // Core numeric/date/boolean values are validated without lossy parseFloat/defaults.
      if (mapping.matchStatus === 'matched_core' && typeof value === 'object' && !(value instanceof Date)) throw new Error('must be a scalar value');
      const converted = coerceImportValue(value, mapping.detectedDataType || CORE_SWINE_FIELDS.find(field => field.key === mapping.targetFieldKey)?.type || 'text');
      if (mapping.matchStatus === 'matched_core') core[mapping.targetFieldKey] = converted;
      else customFields[mapping.targetFieldKey] = converted;
    } catch (error) { issue(mapping.targetFieldKey, value, `${mapping.targetFieldLabel} ${(error as Error).message}.`); }
  });
  const farmerName = String(core.farmer_name ?? '').trim();
  if (!farmerName) issue('farmer_name', '', 'Farmer Name is required and cannot be empty.');
  const rawBarangay = String(core.barangay ?? '').trim();
  const barangay = barangays.find(b => normalizeHeader(b.name) === normalizeHeader(rawBarangay));
  if (!barangay) issue('barangay', rawBarangay, rawBarangay ? `Unknown barangay "${rawBarangay}". Select an existing Hinunangan barangay.` : 'Barangay is required for biosecurity zoning.');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const key of ['farmer_id', 'record_id']) if (core[key] && !uuid.test(String(core[key]))) issue(key, core[key], `${key} must reference a valid UUID.`);
  let tag = String(core.pig_id_tag ?? '').trim().toUpperCase();
  let isDuplicate = false;
  if (tag && !isValidPigIdTag(tag)) issue('pig_id_tag', tag, 'Pig ID must use HIN-YYYY-XXXX.');
  if (tag && seenBatchTags.has(tag)) {
    isDuplicate = true;
    issue('pig_id_tag', tag, `Duplicate Pig ID "${tag}" in this file. Row rejected.`);
  } else if (tag && existingEarTags.has(tag)) {
    isDuplicate = true;
    if (duplicateHandling === 'skip') issue('pig_id_tag', tag, 'Existing Pig ID: row skipped.');
    else if (duplicateHandling === 'rename') { tag = ''; issue('pig_id_tag', '', 'A new official tag will be allocated by the server.', true); }
    else issue('pig_id_tag', tag, 'Existing record will be updated after server identity and permission checks.', true);
  }
  if (tag) seenBatchTags.add(tag);
  const birthDate = String(core.birth_date ?? '');
  if (birthDate && (!validIsoDate(birthDate) || birthDate > new Date().toISOString().slice(0,10))) issue('birth_date', birthDate, 'Birth date must be valid and not in the future.');
  for (const key of ['actual_weight_kg', 'price_estimate', 'pen_capacity', 'age_months']) {
    if (core[key] !== undefined && (core[key] < 0 || (['age_months','pen_capacity'].includes(key) && !Number.isInteger(core[key])))) issue(key, core[key], `${key} must be a nonnegative ${key === 'age_months' || key === 'pen_capacity' ? 'integer' : 'number'}.`);
  }
  const hasLat = core.latitude !== undefined, hasLng = core.longitude !== undefined;
  const validCoordinates = hasLat && hasLng && Math.abs(core.latitude) <= 90 && Math.abs(core.longitude) <= 180;
  if (hasLat !== hasLng || (hasLat && (Math.abs(core.latitude) > 90 || Math.abs(core.longitude) > 180))) issue('coordinates', '', 'Provide both valid latitude and longitude.');
  if (hasLat && hasLng && !isPointInsideHinunangan(core.latitude, core.longitude)) issue('coordinates', '', 'Coordinates are outside Hinunangan. Review this location.', true);
  const age = calculateSwineAge(birthDate);
  const months = age.isValid ? age.totalMonths : core.age_months;
  const days = age.isValid ? age.totalDays : months !== undefined ? months * 30 : undefined;
  const typeAliases: Record<string,string> = { 'breeding sow': 'sow', 'breeding boar': 'boar', 'fattening': 'finisher' };
  const rawType = String(core.swine_type || 'grower').toLowerCase();
  const swineType = typeAliases[rawType] || rawType;
  if (!['piglet','grower','finisher','sow','boar','gilt','suckling','weaner'].includes(swineType)) issue('swine_type', rawType, 'Unrecognized swine classification. Review the category.');
  const mappedRecord: Partial<SwineRecord> = {
    id: core.record_id || crypto.randomUUID(),
    pigIdTag: tag, earTagNo: tag, farmerName,
    ...(core.farmer_id ? {farmerId: core.farmer_id} : {}),
    farmerContact: String(core.farmer_contact ?? ''),
    farmName: String(core.farm_name ?? ''),
    barangay: barangay?.name || rawBarangay,
    ...(barangay?.id ? {barangay_id: barangay.id} : {}),
    birthDate, ageDays: days, ageMonths: months,
    weightKg: core.actual_weight_kg, actualWeightKg: core.actual_weight_kg,
    estimatedWeightKg: days === undefined ? undefined : getEstimatedWeightRange(days),
    swineType: swineType as SwineType,
    farmScale: (core.farm_scale || 'BACKYARD') as FarmScale,
    asfZone: (core.asf_zone || getBarangayASFZone(barangay?.name || '')) as ASFZone,
    ...(core.gender ? {gender: core.gender} : {}),
    ...(core.breed ? {breed: core.breed} : {}),
    readyToSell: core.ready_to_sell ?? false,
    estimatedPricePhp: core.price_estimate,
    penCapacity: core.pen_capacity,
    rsbsaId: String(core.rsbsa_id ?? ''),
    latitude: validCoordinates ? core.latitude : 0, longitude: validCoordinates ? core.longitude : 0,
    status: String(core.status || 'healthy').toLowerCase() as any,
    notes: String(core.notes ?? ''), registeredAt: new Date().toISOString(),
    customFields, isSynced: false,
  };
  return {rowNumber, rawData: rawRow, mappedRecord, errors, warnings, isValid: !errors.length, isDuplicate};
}

/**
 * Generates an intelligent, dynamically structured XLSX template with all core and custom fields
 */
export function generateDynamicImportWorkbook(
  formSchema: RegistryFormSchema,
  format: 'xlsx' | 'csv' = 'xlsx'
): { blob: Blob; fileName: string } {
  // Collect all field headers
  const headers: string[] = [];
  const sampleRow1: Record<string, any> = {};
  const sampleRow2: Record<string, any> = {};

  // Add Core Fields
  CORE_SWINE_FIELDS.forEach(cf => {
    const headerTitle = cf.required ? `${cf.label} *` : cf.label;
    headers.push(headerTitle);

    if (cf.key === 'pig_id_tag') {
      sampleRow1[headerTitle] = 'HIN-2026-0101';
      sampleRow2[headerTitle] = 'HIN-2026-0102';
    } else if (cf.key === 'farmer_name') {
      sampleRow1[headerTitle] = 'Juan Dela Cruz';
      sampleRow2[headerTitle] = 'Maria Santos';
    } else if (cf.key === 'barangay') {
      sampleRow1[headerTitle] = 'Poblacion';
      sampleRow2[headerTitle] = 'Labrador';
    } else if (cf.key === 'farmer_contact') {
      sampleRow1[headerTitle] = '9125918781';
      sampleRow2[headerTitle] = '09287654321';
    } else if (cf.key === 'birth_date') {
      sampleRow1[headerTitle] = '2026-01-15';
      sampleRow2[headerTitle] = '2025-11-20';
    } else if (cf.key === 'breed') {
      sampleRow1[headerTitle] = 'Landrace x Large White';
      sampleRow2[headerTitle] = 'Duroc Hybrid';
    } else if (cf.key === 'swine_type') {
      sampleRow1[headerTitle] = 'grower';
      sampleRow2[headerTitle] = 'finisher';
    } else if (cf.key === 'actual_weight_kg') {
      sampleRow1[headerTitle] = '65.5';
      sampleRow2[headerTitle] = '92.0';
    } else if (cf.key === 'gender') {
      sampleRow1[headerTitle] = 'castrated';
      sampleRow2[headerTitle] = 'female';
    } else if (cf.key === 'ready_to_sell') {
      sampleRow1[headerTitle] = 'No';
      sampleRow2[headerTitle] = 'Yes';
    } else if (cf.key === 'price_estimate') {
      sampleRow1[headerTitle] = '14400';
      sampleRow2[headerTitle] = '20240';
    } else if (cf.key === 'asf_zone') {
      sampleRow1[headerTitle] = 'GREEN';
      sampleRow2[headerTitle] = 'YELLOW';
    } else if (cf.key === 'farm_scale') {
      sampleRow1[headerTitle] = 'BACKYARD';
      sampleRow2[headerTitle] = 'SEMI_COMMERCIAL';
    } else {
      sampleRow1[headerTitle] = '';
      sampleRow2[headerTitle] = '';
    }
  });

  // Add Dynamic Custom Fields from active schema
  (formSchema.sections || []).forEach(sec => {
    if (sec.visible === false) return;
    (sec.fields || []).forEach(fld => {
      if (fld.visible === false || fld.isArchived) return;
      // Skip if already in core fields
      const fKey = getFieldKey(fld);
      if (CORE_SWINE_FIELDS.some(c => c.key === fKey)) return;

      const headerTitle = fld.required ? `${fld.label} *` : fld.label;
      if (!headers.includes(headerTitle)) {
        headers.push(headerTitle);
        if (fld.type === 'date') {
          sampleRow1[headerTitle] = '2026-03-01';
          sampleRow2[headerTitle] = '2026-02-15';
        } else if (fld.type === 'dropdown' && fld.options && fld.options.length > 0) {
          sampleRow1[headerTitle] = fld.options[0];
          sampleRow2[headerTitle] = fld.options[1] || fld.options[0];
        } else if (fld.type === 'yes_no') {
          sampleRow1[headerTitle] = 'Yes';
          sampleRow2[headerTitle] = 'No';
        } else if (fld.type === 'number') {
          sampleRow1[headerTitle] = '10';
          sampleRow2[headerTitle] = '25';
        } else {
          sampleRow1[headerTitle] = fld.defaultValue ? String(fld.defaultValue) : 'Sample Info';
          sampleRow2[headerTitle] = fld.defaultValue ? String(fld.defaultValue) : 'Sample Info';
        }
      }
    });
  });

  const worksheetData = [sampleRow1, sampleRow2];
  const worksheet = XLSX.utils.json_to_sheet(worksheetData, { header: headers });

  // Auto column widths
  const colWidths = headers.map(h => ({ wch: Math.max(h.length + 4, 16) }));
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Swine Registry');

  if (format === 'csv') {
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    return {
      blob,
      fileName: `DA_Hinunangan_Swine_Registry_Template_${new Date().toISOString().split('T')[0]}.csv`,
    };
  }

  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return {
    blob,
    fileName: `DA_Hinunangan_Swine_Registry_Template_${new Date().toISOString().split('T')[0]}.xlsx`,
  };
}
