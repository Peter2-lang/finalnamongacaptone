/** All write paths preserve identifiers, including offline replay. */
export function assertImmutableSwineIdentity(existing:Record<string,any>, patch:Record<string,any>) {
  for(const field of ['id','pigIdTag','earTagNo','computedPigId']){
    if(patch?.[field]!==undefined && existing[field]!==undefined && String(patch[field])!==String(existing[field])){
      throw new Error(`The existing ${field} is immutable. Reload the record before editing.`);
    }
  }
}

export function validateSwineMutation(record: unknown) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('A swine record must be a JSON object.');
  const data = record as Record<string, unknown>;
  for (const field of ['farmerName','farmerContact','barangay','pigIdTag','earTagNo']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`${field} must be text.`);
  }
  for (const field of ['readyToSell','isArchived']) {
    if (data[field] !== undefined && typeof data[field] !== 'boolean') throw new Error(`${field} must be true or false.`);
  }
  for (const field of ['weightKg','actualWeightKg','estimatedPricePhp','priceEstimate','ageMonths','age_months','ageDays']) {
    const value = data[field];
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || (field.startsWith('age') && !Number.isInteger(numeric))) throw new Error(`${field} must be a nonnegative ${field.startsWith('age') ? 'integer' : 'number'}.`);
  }
  for (const [field,limit] of [['latitude',90],['longitude',180]] as const) {
    const value = data[field];
    if (value !== undefined && value !== null && (value === '' || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit)) throw new Error(`${field} is outside the valid coordinate range.`);
  }
  const birthDate = data.birthDate || data.dateOfBirth || data.date_of_birth || data.dob;
  if (birthDate) {
    if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new Error('Birth date must use YYYY-MM-DD.');
    const parsed = new Date(`${birthDate}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== birthDate || birthDate > new Date().toISOString().slice(0,10)) throw new Error('Birth date must be a valid date that is not in the future.');
  }
}
