import * as Linking from 'expo-linking';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { Party, Shop } from '@/db/schema';
import { AppError } from '@/lib/errors';
import {
  buildSmsUrl,
  buildStatementHtml,
  buildStatementText,
  buildWhatsAppUrl,
  type LedgerEntryWithBalance,
} from '@/services/ledger';

export async function callPartyPhone(phone: string | null | undefined): Promise<void> {
  const cleaned = phone?.replace(/[^\d+]/g, '') ?? '';
  if (!cleaned) {
    throw new AppError('VALIDATION', 'No phone number saved for this contact');
  }
  await Linking.openURL(`tel:${cleaned}`);
}

export async function openWhatsAppStatement(params: {
  shopName: string;
  shopPhone?: string | null;
  party: Pick<Party, 'name' | 'phone'>;
  balance: number;
  entries: LedgerEntryWithBalance[];
  decimal?: boolean;
}): Promise<void> {
  const msg = buildStatementText(params);
  const url = buildWhatsAppUrl(params.party.phone, msg);
  await Linking.openURL(url);
}

export async function openSmsStatement(params: {
  shopName: string;
  shopPhone?: string | null;
  party: Pick<Party, 'name' | 'phone'>;
  balance: number;
  entries: LedgerEntryWithBalance[];
  decimal?: boolean;
}): Promise<void> {
  const msg = buildStatementText(params);
  const url = buildSmsUrl(params.party.phone, msg);
  await Linking.openURL(url);
}

export async function shareStatementPdf(params: {
  shop: Pick<Shop, 'name' | 'phone' | 'address'>;
  party: Pick<Party, 'name' | 'type' | 'phone' | 'address'>;
  openingBalance: number;
  closingBalance: number;
  totalGiven: number;
  totalTaken: number;
  entries: LedgerEntryWithBalance[];
  decimal?: boolean;
  from?: number;
  to?: number;
}): Promise<void> {
  const html = buildStatementHtml(params);
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `${params.party.name} Statement`,
      UTI: 'com.adobe.pdf',
    });
  } else {
    await Print.printAsync({ uri });
  }
}
