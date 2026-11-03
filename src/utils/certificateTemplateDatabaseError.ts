export interface CertificateTemplateDatabaseFailure {
  code?: string;
  message: string;
}

export function formatCertificateTemplateDatabaseError(error: unknown): CertificateTemplateDatabaseFailure {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
  const message = error instanceof Error ? error.message : 'Unknown database error';

  if (code === '42P01') {
    return {
      code,
      message: 'A certificate-template table or related table is missing. Verify the applied application migrations, including 008_certificate_templates_runtime_schema.sql and 011_certificate_template_assets_and_schema_repair.sql.',
    };
  }
  if (code === '42703') {
    const missingColumn = message.match(/column\s+["']?([\w.]+)["']?\s+does not exist/i)?.[1];
    return {
      code,
      message: missingColumn === 'ct.template_data' || missingColumn === 'template_data'
        ? `The configured database reports missing column "${missingColumn}" on public.certificate_templates. Apply 011_certificate_template_assets_and_schema_repair.sql to the intended Supabase project and verify the live table schema.`
        : missingColumn
          ? `The configured database reports missing column "${missingColumn}" required by the certificate-template query. Confirm the application is connected to the intended Supabase project and compare its live schema with the query.`
          : 'The configured database reports a missing column required by the certificate-template query. Confirm the application is connected to the intended Supabase project and compare its live schema with the query.',
    };
  }
  if (code === '42501') {
    return {
      code,
      message: 'The configured database role cannot read or update certificate templates. Check server database grants and template access policies.',
    };
  }
  if (code === '28P01' || code === '28000') {
    return {
      code,
      message: 'PostgreSQL rejected the configured server database credentials. Verify DATABASE_URL without sharing its value.',
    };
  }
  if (code === '3D000' || code === '3F000') {
    return {
      code,
      message: 'The configured PostgreSQL database or schema does not exist. Verify the database target and applied migrations.',
    };
  }
  if (
    code?.startsWith('08') ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND'
  ) {
    return {
      code,
      message: 'The application could not reach its configured PostgreSQL database. Verify DATABASE_URL and database availability.',
    };
  }
  if (
    message.startsWith('Saved certificate template "') ||
    message.startsWith('No database barangay matches') ||
    message.startsWith('Each certificate template requires')
  ) {
    return { code, message };
  }
  if (message.startsWith('Focal Persons can only') || message.startsWith('Focal Persons cannot')) {
    return { code: '403', message };
  }
  if (message.startsWith('Certificate template changed in another session')) {
    return { code: '409', message };
  }
  return {
    code,
    message: 'The certificate template database request failed. Check server logs for its diagnostic code and details.',
  };
}