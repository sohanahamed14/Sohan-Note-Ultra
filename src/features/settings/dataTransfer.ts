import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { AppError } from '@/lib/errors';

function safeFilePart(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return clean || 'shop';
}

/** Saves exported shop JSON and triggers native share sheet or browser download. */
export async function shareShopDataJson(json: string, shopName: string): Promise<void> {
  const dateTag = new Date().toISOString().slice(0, 10);
  const filename = `${safeFilePart(shopName)}-backup-${dateTag}.json`;

  if (Platform.OS === 'web') {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
      throw new AppError('UNKNOWN', 'File download is not supported in this browser');
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, filename);
  await file.write(json);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new AppError('UNKNOWN', 'Sharing is not available on this device');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Download shop data',
    UTI: 'public.json',
  });
}
