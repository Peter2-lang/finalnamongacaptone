import type { SwineRecord, SwineStatus } from '../types.ts';

export const MAX_FARMER_SWINE_BATCH = 20;

export const farmerProfileFields = new Set([
  'fld_farmer_name', 'fld_contact_phone', 'fld_barangay', 'fld_farm_name',
  'fld_sitio', 'fld_rsbsa_id', 'fld_email', 'fld_residential_address',
]);

export const registrationStatuses: SwineStatus[] = [
  'healthy', 'under_observation', 'suspected_asf', 'asf_positive',
  'recovered_cleared', 'sick', 'quarantined', 'ready_to_sell', 'sold', 'deceased',
];

export interface FarmerSwineDraft {
  record: SwineRecord;
  photo?: File;
  attachments: { id: string; key: string; type: 'file' | 'image'; file: File }[];
}

export interface FarmerSwineBatch {
  farmerId: string;
  batchId: string;
  drafts: FarmerSwineDraft[];
}
