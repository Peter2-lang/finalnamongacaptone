import { randomUUID } from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface LandingUploadResult {
  filePath: string;
  fileUrl: string;
  fileSize: number;
}

export interface CertificateAssetUploadScope {
  isAdmin: boolean;
  assignedBarangay: string;
}

const IMAGE_CONTENT_TYPES: Record<string, { extensions: string[]; matches: (file: Buffer) => boolean }> = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], matches: file => file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff },
  'image/png': { extensions: ['png'], matches: file => file[0] === 0x89 && file.toString('ascii', 1, 4) === 'PNG' },
  'image/webp': { extensions: ['webp'], matches: file => file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP' },
  'image/gif': { extensions: ['gif'], matches: file => ['GIF87a', 'GIF89a'].includes(file.toString('ascii', 0, 6)) },
};

const LEGAL_DOCUMENT_CONTENT_TYPES: Record<string, { extensions: string[]; matches: (file: Buffer) => boolean }> = {
  'application/pdf': { extensions: ['pdf'], matches: file => file.toString('ascii', 0, 5) === '%PDF-' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['docx'],
    matches: file => file[0] === 0x50 && file[1] === 0x4b && file[2] === 0x03 && file[3] === 0x04,
  },
  'image/jpeg': { extensions: ['jpg', 'jpeg'], matches: file => file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff },
  'image/png': { extensions: ['png'], matches: file => file[0] === 0x89 && file.toString('ascii', 1, 4) === 'PNG' },
};

function decodeImage(fileName: string, mimeType: string, base64Payload: string): Buffer {
  const match = base64Payload.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/s);
  if (!match || match[1].toLowerCase() !== mimeType.toLowerCase()) {
    throw new Error('The image payload is malformed or its declared MIME type does not match.');
  }
  const file = Buffer.from(match[2], 'base64');
  if (file.length === 0 || file.length > 15 * 1024 * 1024) {
    throw new Error('The uploaded image is empty or exceeds the 15 MB limit.');
  }
  const contentType = mimeType.toLowerCase();
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const imageType = IMAGE_CONTENT_TYPES[contentType];
  if (!imageType || !imageType.extensions.includes(extension) || !imageType.matches(file)) {
    throw new Error('Only genuine JPEG, PNG, WebP, or GIF images with matching MIME type and extension are accepted.');
  }
  return file;
}

export async function uploadCertificateAsset(
  supabase: SupabaseClient,
  fileName: string,
  mimeType: string,
  base64Payload: string,
  scope: CertificateAssetUploadScope
): Promise<LandingUploadResult> {
  const file = decodeImage(fileName, mimeType, base64Payload);
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'certificate-image';
  const safeBarangay = scope.assignedBarangay.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '_');
  if (!scope.isAdmin && !safeBarangay) {
    throw new Error('A focal person must have an assigned barangay to upload certificate assets.');
  }
  const filePath = scope.isAdmin
    ? `shared/certificate-assets/${randomUUID()}-${safeFileName}`
    : `barangays/${safeBarangay}/certificate-assets/${randomUUID()}-${safeFileName}`;
  const uploaded = await supabase.storage.from('certificates').upload(filePath, file, {
    contentType: mimeType.toLowerCase(),
    cacheControl: '3600',
    upsert: false,
  });
  if (uploaded.error) throw new Error(`Supabase certificate asset upload failed: ${uploaded.error.message}`);
  const signed = await supabase.storage.from('certificates').createSignedUrl(filePath, 60 * 60);
  if (signed.error) throw new Error(`Unable to create a certificate asset preview URL: ${signed.error.message}`);
  return { filePath, fileUrl: signed.data.signedUrl, fileSize: file.length };
}

export async function createCertificateAssetSignedUrl(
  supabase: SupabaseClient,
  filePath: string
): Promise<string> {
  if (
    filePath.includes('..') ||
    !/^(?:shared\/certificate-assets|barangays\/[a-z0-9 _-]+\/certificate-assets)\/[a-z0-9._-]+$/i.test(filePath)
  ) {
    throw new Error('The saved certificate asset path is invalid.');
  }
  const signed = await supabase.storage.from('certificates').createSignedUrl(filePath, 60 * 60);
  if (signed.error) throw new Error(`Unable to load a saved certificate image: ${signed.error.message}`);
  return signed.data.signedUrl;
}

export async function uploadLandingCmsAsset(
  fileName: string,
  mimeType: string,
  base64Payload: string,
  category: string
): Promise<LandingUploadResult> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !adminKey) {
      throw new Error('Server-side Supabase Storage is unavailable. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) as server-side environment variables.');
  }

  const file = decodeImage(fileName, mimeType, base64Payload);
  const contentType = mimeType.toLowerCase();

    const supabase = createClient(supabaseUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const bucket = process.env.SUPABASE_LANDING_MEDIA_BUCKET || 'landing-page-media';
  const buckets = await supabase.storage.listBuckets();
  if (buckets.error) throw new Error(`Unable to inspect Supabase Storage buckets: ${buckets.error.message}`);

  if (!buckets.data.some(item => item.name === bucket)) {
    const created = await supabase.storage.createBucket(bucket, { public: true });
    if (created.error) throw new Error(`Unable to create the ${bucket} Storage bucket: ${created.error.message}`);
  }

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'asset';
  const safeCategory = category.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'other';
  const filePath = `${safeCategory}/${randomUUID()}-${safeFileName}`;
  const uploaded = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploaded.error) throw new Error(`Supabase Storage upload failed: ${uploaded.error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return { filePath, fileUrl: data.publicUrl, fileSize: file.length };
}

export async function deleteLandingCmsAsset(filePath: string): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !adminKey) {
      throw new Error('Server-side Supabase Storage is unavailable. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) as server-side environment variables.');
    }
  const bucket = process.env.SUPABASE_LANDING_MEDIA_BUCKET || 'landing-page-media';
    const supabase = createClient(supabaseUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const result = await supabase.storage.from(bucket).remove([filePath]);
  if (result.error) throw new Error(`Failed to remove Supabase Storage object: ${result.error.message}`);
}
/** Validate a completed direct upload before it can be referenced by application rows. */
export async function verifyDirectImage(
  supabase: SupabaseClient, bucket: string, filePath: string, fileName: string, mimeType: string,
  allowedPrefix: string,
): Promise<LandingUploadResult> {
  if (!filePath.startsWith(allowedPrefix) || filePath.includes('..')) throw new Error('Image path is outside your upload scope.');
  const result = await supabase.storage.from(bucket).download(filePath);
  if (result.error) throw new Error('Uploaded image could not be found.');
  const bytes = Buffer.from(await result.data.arrayBuffer());
  decodeImage(fileName, mimeType, `data:${mimeType};base64,${bytes.toString('base64')}`);
  let fileUrl: string;
  if (bucket === 'certificates') fileUrl = await createCertificateAssetSignedUrl(supabase, filePath);
  else fileUrl = supabase.storage.from(bucket).getPublicUrl(filePath).data.publicUrl;
  return { filePath, fileUrl, fileSize: bytes.length };
}

export async function verifyDirectLegalDocument(
  supabase: SupabaseClient,
  filePath: string,
  fileName: string,
  mimeType: string,
  documentId: string,
): Promise<LandingUploadResult> {
  const safeDocumentId = documentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeDocumentId || safeDocumentId !== documentId || filePath.includes('..') ||
      !filePath.startsWith(`legal-documents/${safeDocumentId}/`)) {
    throw new Error('The uploaded legal document path is outside its document scope.');
  }
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const type = LEGAL_DOCUMENT_CONTENT_TYPES[mimeType.toLowerCase()];
  if (!type || !type.extensions.includes(extension)) {
    throw new Error('Choose a PDF, DOCX, JPEG, or PNG legal document with a matching file type.');
  }
  const result = await supabase.storage.from('documents').download(filePath);
  if (result.error) throw new Error('Uploaded legal document could not be found in private Supabase Storage.');
  const bytes = Buffer.from(await result.data.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) {
    throw new Error('Legal documents must be non-empty and no larger than 25 MB.');
  }
  if (!type.matches(bytes)) throw new Error('The legal document contents do not match the declared file type.');
  const signed = await supabase.storage.from('documents').createSignedUrl(filePath, 60 * 60);
  if (signed.error) throw new Error(`Unable to create a private legal document preview URL: ${signed.error.message}`);
  return { filePath, fileUrl: signed.data.signedUrl, fileSize: bytes.length };
}

export async function createLegalDocumentSignedUrl(
  supabase: SupabaseClient,
  filePath: string,
  documentId: string,
): Promise<string> {
  const safeDocumentId = documentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeDocumentId || safeDocumentId !== documentId || filePath.includes('..') ||
      !/^legal-documents\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(filePath) ||
      !filePath.startsWith(`legal-documents/${safeDocumentId}/`)) {
    throw new Error('The saved legal document attachment path is invalid.');
  }
  const signed = await supabase.storage.from('documents').createSignedUrl(filePath, 60 * 60);
  if (signed.error) throw new Error(`Unable to open the private legal document attachment: ${signed.error.message}`);
  return signed.data.signedUrl;
}
