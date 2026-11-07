type SwineArchiveActor = {
  role: string;
  permissions?: string[];
  assignedBarangay?: string;
};

type SwineArchiveRecord = {
  barangay?: string;
};

const ARCHIVE_PERMISSION = 'swine_records.archive';
const RESTORE_PERMISSION = 'swine_records.restore';
const PERMANENT_DELETE_PERMISSION = 'swine_records.permanent_delete';

function hasScopedPermission(actor: SwineArchiveActor, permission: string, record: SwineArchiveRecord): boolean {
  return actor.role === 'focal' &&
    Boolean(actor.assignedBarangay?.trim()) &&
    actor.assignedBarangay!.trim().toLowerCase() === (record.barangay || '').trim().toLowerCase() &&
    actor.permissions?.includes(permission) === true;
}

export function canArchiveSwineRecord(
  actor: SwineArchiveActor,
  record: SwineArchiveRecord,
  archived: boolean,
): boolean {
  if (actor.role === 'super_admin' || actor.role === 'admin') return true;
  if (archived) return hasScopedPermission(actor, ARCHIVE_PERMISSION, record);
  return hasScopedPermission(actor, RESTORE_PERMISSION, record);
}

export function canPermanentlyDeleteSwineRecord(actor: SwineArchiveActor): boolean {
  return actor.role === 'super_admin' ||
    (actor.role === 'admin' && actor.permissions?.includes(PERMANENT_DELETE_PERMISSION) === true);
}
