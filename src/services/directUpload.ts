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
