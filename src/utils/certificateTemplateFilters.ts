import { CertificateTemplate } from '../types';

export interface CertificateTemplateFilters {
  search: string;
  barangay: string;
  documentType: string;
  language: string;
}

export interface CertificateTemplateUserScope {
  isAdmin: boolean;
  barangayId: string;
  assignedBarangay: string;
}

const normalize = (value: string | undefined) => (value || '').trim().toLocaleLowerCase();

export function filterCertificateTemplates(
  templates: CertificateTemplate[],
  filters: CertificateTemplateFilters,
): CertificateTemplate[] {
  const search = normalize(filters.search);
  const barangayFilter = normalize(filters.barangay);
  const typeFilter = normalize(filters.documentType);
  const languageFilter = normalize(filters.language);

  return templates.filter(template => {
    const name = normalize(template.name);
    const barangay = normalize(template.barangay);
    const documentType = normalize(template.documentType);
    const documentTitle = normalize(template.documentTitle);
    const language = normalize(template.language);
    const matchesSearch = !search || [name, barangay, documentType, documentTitle, language]
      .some(value => value.includes(search));
    const matchesBarangay = !barangayFilter || !barangay || barangay === 'all' || barangay === barangayFilter;
    const matchesType = !typeFilter || !documentType || documentType === typeFilter;
    const matchesLanguage = !languageFilter || !language || language === languageFilter;
    return matchesSearch && matchesBarangay && matchesType && matchesLanguage;
  });
}

export function filterCertificateTemplatesForUser(
  templates: CertificateTemplate[],
  user: CertificateTemplateUserScope,
): CertificateTemplate[] {
  if (user.isAdmin) return templates;

  const assignedBarangay = normalize(user.assignedBarangay);
  return templates.filter(template => {
    const scope = normalize(template.barangay);
    if (template.barangayId && user.barangayId === template.barangayId) return true;
    if (template.barangayId) {
      return Boolean(assignedBarangay && scope === assignedBarangay);
    }
    return !scope || scope === 'all' || Boolean(assignedBarangay && scope === assignedBarangay);
  });
}
