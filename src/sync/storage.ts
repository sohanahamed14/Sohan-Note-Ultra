import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { AppError } from '@/lib/errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  MAX_IMAGE_BYTES,
  PUBLIC_IMAGES_BUCKET,
  detectImageFormat,
  isLocalFileUri,
} from './imageUtils';

export {
  MAX_IMAGE_BYTES,
  PUBLIC_IMAGES_BUCKET,
  detectImageFormat,
  isLocalFileUri,
  type AllowedImageMime,
} from './imageUtils';

async function readImageBytes(localUri: string): Promise<Uint8Array> {
  if (
    Platform.OS !== 'web' &&
    (localUri.startsWith('file://') || localUri.startsWith('content://'))
  ) {
    const file = new File(localUri);
    return await file.bytes();
  }
  const res = await fetch(localUri);
  if (!res.ok) {
    throw new AppError('VALIDATION', 'Could not read selected image');
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Upload an image to Supabase Storage bucket `public-images` under `<shopId>/<relativePath>`.
 * Returns the public URL required by the public storefront and invoices.
 */
export async function uploadShopImage(
  shopId: string,
  localUri: string,
  relativePath: string,
): Promise<string> {
  if (!isLocalFileUri(localUri)) return localUri;
  if (!isSupabaseConfigured) {
    throw new AppError('NETWORK', 'Cloud storage is not configured');
  }
  const cleanRel = relativePath.replace(/^\/+/, '');
  if (!shopId || !cleanRel || cleanRel.includes('..')) {
    throw new AppError('VALIDATION', 'Invalid upload path');
  }
  const { contentType } = detectImageFormat(localUri);
  const bytes = await readImageBytes(localUri);
  if (bytes.byteLength === 0) {
    throw new AppError('VALIDATION', 'Image file is empty');
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError('VALIDATION', 'Image exceeds 5 MB limit');
  }
  const fullPath = `${shopId}/${cleanRel}`;
  const { error } = await supabase.storage.from(PUBLIC_IMAGES_BUCKET).upload(fullPath, bytes, {
    upsert: true,
    contentType,
  });
  if (error) {
    throw new AppError('NETWORK', `Image upload failed: ${error.message}`);
  }
  return supabase.storage.from(PUBLIC_IMAGES_BUCKET).getPublicUrl(fullPath).data.publicUrl;
}
