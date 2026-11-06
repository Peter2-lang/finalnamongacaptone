import { supabase } from '../lib/supabase.ts';
import { requestJson } from './http.ts';

export async function uploadImageDirect(file: File, target: 'certificate' | 'landing' | 'media'): Promise<string> {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Choose an image no larger than 15 MB.');
  const ticket = await requestJson<{ bucket: string; filePath: string; token: string }>('/api/storage/upload-url', {
    method: 'POST', body: JSON.stringify({ target, fileName: file.name, mimeType: file.type }),
  });
  const result = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.filePath, ticket.token, file, { contentType: file.type });
  if (result.error) throw new Error(`Unable to upload image: ${result.error.message}`);
  return ticket.filePath;
}

export async function uploadLegalDocumentDirect(file: File, documentId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  if (!file.size || file.size > 25 * 1024 * 1024) {
    throw new Error('Legal documents must be non-empty and no larger than 25 MB.');
  }
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const accepted: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
  };
  if (!accepted[file.type]?.includes(extension)) {
    throw new Error('Choose a PDF, DOCX, JPEG, or PNG legal document with a matching file extension.');
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches = file.type === 'application/pdf'
    ? String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'
    : file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ? bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
      : file.type === 'image/jpeg'
        ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!matches) throw new Error('The legal document contents do not match the declared file type.');

  const ticket = await requestJson<{ bucket: string; filePath: string; token: string }>('/api/storage/upload-url', {
    method: 'POST',
    body: JSON.stringify({ target: 'legal-document', documentId, fileName: file.name, mimeType: file.type }),
  });
  const result = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.filePath, ticket.token, file, {
    contentType: file.type,
  });
  if (result.error) throw new Error(`Unable to upload legal document: ${result.error.message}`);
  return ticket.filePath;
}
