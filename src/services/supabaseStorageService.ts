import { supabase } from '../lib/supabase';

const MEDIA_BUCKET = 'landing-page-media';
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const IMAGE_SIGNATURES: Record<string, { extensions: string[]; signature: (bytes: Uint8Array) => boolean }> = {
  'image/jpeg': {
    extensions: ['jpg', 'jpeg'],
    signature: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  'image/png': {
    extensions: ['png'],
    signature: bytes => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  },
  'image/webp': {
    extensions: ['webp'],
    signature: bytes => String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP',
  },
  'image/gif': {
    extensions: ['gif'],
    signature: bytes => ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6))),
  },
};

export async function validateImageFile(file: File): Promise<string> {
  if (file.size === 0 || file.size > MAX_IMAGE_SIZE) {
    throw new Error('Image must be non-empty and no larger than 8 MB.');
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const signature = IMAGE_SIGNATURES[file.type];
  if (!signature || !signature.extensions.includes(extension)) {
    throw new Error('Choose a valid JPEG, PNG, WebP, or GIF image with a matching file extension.');
  }

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!signature.signature(bytes)) {
    throw new Error('The uploaded image contents do not match the declared file type.');
  }
  return extension === 'jpeg' ? 'jpg' : extension;
}

export async function uploadSwineImage(
  file: File,
  barangay: string,
  swineId: string,
  fieldKey?: string
): Promise<{ path: string; url: string }> {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  const extension = await validateImageFile(file);
  const barangaySegment = barangay.trim().replace(/[\\/]/g, '').replace(/\.\./g, '');
  if (!barangaySegment) throw new Error('A valid barangay is required for the image storage path.');
  const imageName = fieldKey
    ? `${fieldKey.replace(/[^a-zA-Z0-9_-]/g, '_')}-${crypto.randomUUID()}.${extension}`
    : `photo-${crypto.randomUUID()}.${extension}`;
  const path = `barangays/${barangaySegment}/swine/${swineId}/${fieldKey ? 'images' : ''}${fieldKey ? `/${imageName}` : imageName}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(`Unable to upload swine photo to Supabase Storage: ${error.message}`);

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

const DOCUMENT_SIGNATURES: Record<string, { extensions: string[]; signature: (bytes: Uint8Array) => boolean }> = {
  'application/pdf': { extensions: ['pdf'], signature: bytes => String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-' },
  'application/msword': {
    extensions: ['doc'],
    signature: bytes => bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0,
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['docx'],
    signature: bytes => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04,
  },
  'image/jpeg': IMAGE_SIGNATURES['image/jpeg'],
  'image/png': IMAGE_SIGNATURES['image/png'],
};

export async function uploadSwineDocument(
  file: File,
  barangay: string,
  swineId: string
): Promise<{ id: string; originalFilename: string; storagePath: string; mimeType: string; fileSize: number }> {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Document must be non-empty and no larger than 15 MB.');
  const signature = DOCUMENT_SIGNATURES[file.type];
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!signature || !signature.extensions.includes(extension)) {
    throw new Error('Choose a PDF, DOC, DOCX, JPEG, or PNG document with a matching extension.');
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!signature.signature(bytes)) throw new Error('The document contents do not match the declared file type.');

  const barangaySegment = barangay.trim().replace(/[\\/]/g, '').replace(/\.\./g, '');
  const { data: barangayRow, error: barangayError } = await supabase
    .from('barangays')
    .select('id')
    .ilike('name', barangaySegment)
    .limit(1)
    .maybeSingle();
  if (barangayError) throw new Error(`Unable to verify the document barangay: ${barangayError.message}`);
  if (!barangayRow?.id) throw new Error(`Barangay "${barangay}" is not registered in Supabase.`);

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error('A valid Supabase-authenticated session is required to upload documents.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || `attachment.${extension}`;
  const path = `barangays/${barangaySegment}/swine/${swineId}/documents/${crypto.randomUUID()}-${safeName}`;
  const uploaded = await supabase.storage.from('documents').upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploaded.error) throw new Error(`Unable to upload document to Supabase Storage: ${uploaded.error.message}`);

  const { data: metadata, error: metadataError } = await supabase
    .from('uploaded_documents')
    .insert({
      barangay_id: barangayRow.id,
      related_module: 'swine',
      related_record_id: swineId,
      original_filename: file.name,
      storage_bucket: 'documents',
      storage_path: path,
      mime_type: file.type,
      file_size: file.size,
      uploader_id: authData.user.id,
    })
    .select('id')
    .single();
  if (metadataError || !metadata) {
    const cleanup = await supabase.storage.from('documents').remove([path]);
    if (cleanup.error) console.error('Unable to clean up document after metadata insert failure:', cleanup.error.message);
    throw new Error(`Unable to save uploaded document metadata: ${metadataError?.message || 'No metadata row returned.'}`);
  }
  return { id: metadata.id, originalFilename: file.name, storagePath: path, mimeType: file.type, fileSize: file.size };
}

export async function removeSwineDocument(documentId: string, storagePath: string): Promise<void> {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  const { error: metadataError } = await supabase.from('uploaded_documents').delete().eq('id', documentId);
  if (metadataError) throw new Error(`Unable to remove document metadata: ${metadataError.message}`);
  const { error: storageError } = await supabase.storage.from('documents').remove([storagePath]);
  if (storageError) throw new Error(`Unable to remove document from Supabase Storage: ${storageError.message}`);
}

export async function removeSwineImage(path: string): Promise<void> {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  if (error) throw new Error(`Unable to remove the unreferenced swine image: ${error.message}`);
}
