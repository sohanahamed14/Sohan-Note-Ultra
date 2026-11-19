import * as ImagePicker from 'expo-image-picker';
import { AppError } from '@/lib/errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MAX_BYTES = 5 * 1024 * 1024;

export type PickedImageResult = {
  uri: string;
  uploaded: boolean;
};

/** Picks an image from the library and uploads to `public-images/<shopId>/<filename>` if online. */
export async function pickAndUploadShopImage(
  shopId: string,
  filename: string,
): Promise<PickedImageResult | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new AppError('FORBIDDEN', 'Photo library permission is required to pick an image');
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.82,
  });

  if (picked.canceled || !picked.assets?.[0]) {
    return null;
  }

  const asset = picked.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_BYTES) {
    throw new AppError('VALIDATION', 'Image must be smaller than 5 MB');
  }

  if (isSupabaseConfigured) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        const res = await fetch(asset.uri);
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength > MAX_BYTES) {
          throw new AppError('VALIDATION', 'Image must be smaller than 5 MB');
        }
        const path = `${shopId}/${filename}`;
        const contentType = asset.mimeType ?? 'image/jpeg';
        const { error } = await supabase.storage
          .from('public-images')
          .upload(path, bytes, { upsert: true, contentType });
        if (!error) {
          const { data } = supabase.storage.from('public-images').getPublicUrl(path);
          return { uri: `${data.publicUrl}?t=${Date.now()}`, uploaded: true };
        }
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      // Offline or storage unavailable: keep local URI so user can continue seamlessly.
    }
  }

  return { uri: asset.uri, uploaded: false };
}
