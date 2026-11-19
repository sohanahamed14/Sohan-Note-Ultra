import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { AppError } from '@/lib/errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type PickedImage = {
  uri: string;
  mimeType: string;
};

/** Launches gallery or camera image picker using SDK 58 non-deprecated mediaTypes. */
export async function pickProductImage(
  source: 'library' | 'camera',
): Promise<PickedImage | null> {
  if (Platform.OS !== 'web') {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        throw new AppError('FORBIDDEN', 'Camera permission is required to take a photo');
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        throw new AppError('FORBIDDEN', 'Photo library permission is required to pick an image');
      }
    }
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.75,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
  };
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  return 'jpg';
}

/**
 * Uploads product image to Supabase `public-images/<shopId>/products/<productId>.<ext>`
 * when online and authenticated; falls back gracefully to the local URI offline.
 */
export async function uploadProductImageIfOnline(
  shopId: string,
  productId: string,
  localUri: string,
  mimeType = 'image/jpeg',
): Promise<string> {
  if (!localUri || /^https?:\/\//i.test(localUri)) return localUri;
  if (!isSupabaseConfigured) return localUri;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return localUri;

    const response = await fetch(localUri);
    const bytes = await response.arrayBuffer();
    const ext = extFromMime(mimeType);
    const path = `${shopId}/products/${productId}.${ext}`;
    const contentType =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    const { error } = await supabase.storage
      .from('public-images')
      .upload(path, bytes, { contentType, upsert: true });

    if (error) return localUri;
    const { data } = supabase.storage.from('public-images').getPublicUrl(path);
    return data.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : localUri;
  } catch {
    return localUri;
  }
}
