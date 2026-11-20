export const PUBLIC_IMAGES_BUCKET = 'public-images';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function isLocalFileUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  const trimmed = uri.trim();
  if (trimmed === '') return false;
  return !/^https?:\/\//i.test(trimmed);
}

export function detectImageFormat(uri: string): {
  contentType: AllowedImageMime;
  ext: 'jpg' | 'png' | 'webp';
} {
  const lower = uri.toLowerCase();
  if (lower.startsWith('data:image/png') || /\.png(\?|$)/.test(lower)) {
    return { contentType: 'image/png', ext: 'png' };
  }
  if (lower.startsWith('data:image/webp') || /\.webp(\?|$)/.test(lower)) {
    return { contentType: 'image/webp', ext: 'webp' };
  }
  return { contentType: 'image/jpeg', ext: 'jpg' };
}
