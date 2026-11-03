import { supabase } from './supabaseClient';
import { CertificateLogoSettings } from '../components/certificate/CertificateLogoCustomizer';
import { CertificateData } from '../components/certificate/BarangayCertificateView';

export function mapDbToLogoSettings(row: any, fallbackBrgy: string): CertificateLogoSettings {
  if (!row) {
    return {
      leftLogoType: 'barangay',
      leftBarangayName: fallbackBrgy,
      centerLogoType: 'municipality',
      rightLogoType: 'bagong_pilipinas',
      showWatermark: true,
      watermarkType: 'municipality',
      watermarkOpacity: 0.12,
      printLogoSize: 72,
      printShowWatermark: true,
      printWatermarkOpacity: 0.10,
      printGrayscale: false,
      printHideCenterLogo: false,
    };
  }

  return {
    leftLogoType: row.left_logo_type ?? 'barangay',
    leftLogoUrl: row.left_logo_url ?? undefined,
    leftBarangayName: row.left_barangay_name ?? fallbackBrgy,
    centerLogoType: row.center_logo_type ?? 'municipality',
    centerLogoUrl: row.center_logo_url ?? undefined,
    rightLogoType: row.right_logo_type ?? 'bagong_pilipinas',
    rightLogoUrl: row.right_logo_url ?? undefined,
    showWatermark: row.show_watermark ?? true,
    watermarkType: row.watermark_type ?? 'municipality',
    watermarkUrl: row.watermark_url ?? undefined,
    watermarkOpacity: Number(row.watermark_opacity ?? 0.12),
    barangayEmail: row.barangay_email ?? undefined,
    barangayPhone: row.barangay_phone ?? undefined,
    headerMotto: row.header_motto ?? undefined,
    printLogoSize: row.print_logo_size ?? 72,
    printShowWatermark: row.print_show_watermark ?? true,
    printWatermarkOpacity: Number(row.print_watermark_opacity ?? 0.10),
    printGrayscale: row.print_grayscale ?? false,
    printHideCenterLogo: row.print_hide_center_logo ?? false,
  };
}

export const certificateService = {
  async getLogoSettings(barangayName: string): Promise<CertificateLogoSettings> {
    const { data, error } = await supabase
      .from('certificate_logo_settings')
      .select('*')
      .ilike('barangay_name', barangayName.trim())
      .maybeSingle();

    if (error) {
      console.error('Error fetching certificate logo settings:', error.message);
    }
    return mapDbToLogoSettings(data, barangayName);
  },

  async saveLogoSettings(barangayName: string, settings: CertificateLogoSettings): Promise<void> {
    const payload = {
      barangay_name: barangayName.toUpperCase().trim(),
      left_logo_type: settings.leftLogoType,
      left_logo_url: settings.leftLogoUrl || null,
      left_barangay_name: settings.leftBarangayName || barangayName,
      center_logo_type: settings.centerLogoType,
      center_logo_url: settings.centerLogoUrl || null,
      right_logo_type: settings.rightLogoType,
      right_logo_url: settings.rightLogoUrl || null,
      show_watermark: settings.showWatermark,
      watermark_type: settings.watermarkType,
      watermark_url: settings.watermarkUrl || null,
      watermark_opacity: settings.watermarkOpacity,
      barangay_email: settings.barangayEmail || null,
      barangay_phone: settings.barangayPhone || null,
      header_motto: settings.headerMotto || null,
      print_logo_size: settings.printLogoSize || 72,
      print_show_watermark: settings.printShowWatermark ?? settings.showWatermark,
      print_watermark_opacity: settings.printWatermarkOpacity ?? settings.watermarkOpacity,
      print_grayscale: settings.printGrayscale ?? false,
      print_hide_center_logo: settings.printHideCenterLogo ?? false,
    };

    const { error } = await supabase
      .from('certificate_logo_settings')
      .upsert(payload, { onConflict: 'barangay_name' });

    if (error) throw new Error(error.message);
  },

  async issueCertificate(data: CertificateData, settings: CertificateLogoSettings): Promise<string> {
    const certNumber = data.certificateNo || `CERT-${Date.now().toString().slice(-6)}`;

    const { data: record, error } = await supabase
      .from('issued_certificates')
      .insert({
        certificate_no: certNumber,
        template_style: data.templateStyle,
        barangay: data.barangay,
        farmer_name: data.farmerName,
        association_name: data.associationName || null,
        farmer_age_civil_status: data.farmerAgeCivilStatus || null,
        buyer_name: data.buyerName,
        buyer_entity: data.buyerEntity || null,
        destination: data.destination,
        number_of_heads: data.numberOfHeads,
        swine_age: data.swineAge || null,
        female_count: Number(data.femaleCount || 0),
        male_count: Number(data.maleCount || 0),
        color_description: data.colorDescription || null,
        price_description: data.priceDescription || null,
        or_number: data.orNumber,
        amount_paid: Number(data.amountPaid || 0),
        issue_date: data.issueDate || new Date().toISOString().split('T')[0],
        issued_at: data.issuedAt || null,
        punong_barangay: data.punongBarangay,
        punong_barangay_title: data.punongBarangayTitle || 'Punong Barangay',
        bbo_name: data.bboName,
        bbo_title: data.bboTitle || 'Barangay Biosecurity Officer',
        attested_by_name: data.attestedByName || null,
        attested_by_title: data.attestedByTitle || null,
        custom_body: data.customBody || null,
        logo_settings_snapshot: settings,
      })
      .select('certificate_no')
      .single();

    if (error) throw new Error(error.message);
    return record.certificate_no;
  },
};