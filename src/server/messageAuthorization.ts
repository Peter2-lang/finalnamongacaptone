/** A focal report stays in its assigned barangay and is visible to municipal admins. */
export function authorizeMessagePayload(payload: Record<string, any>, user: {role:string;assignedBarangay:string}) {
  if (!['super_admin','admin','focal'].includes(user.role)) throw new Error('This account has view-only messaging access.');
  if (user.role !== 'focal') return payload;
  if (!user.assignedBarangay) throw new Error('An assigned barangay is required to send reports.');
  const target = payload.targetBarangay || payload.recipientBarangay || user.assignedBarangay;
  if (typeof target !== 'string' || target.trim().toLowerCase() !== user.assignedBarangay.trim().toLowerCase() || payload.recipientId || payload.receiverId) {
    throw new Error('Focal reports must stay within the assigned barangay. Only administrators may broadcast or select other recipients.');
  }
  return {...payload,targetBarangay:user.assignedBarangay,recipientBarangay:user.assignedBarangay,barangay:user.assignedBarangay};
}
