import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Print from 'expo-print';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  buildBusinessCardHtml,
  buildCardQrValue,
  CARD_THEMES,
  type CardTheme,
} from '@/features/settings/businessCardHtml';
import { errorMessage } from '@/lib/errors';
import { getProfileCompletion } from '@/services/shop';
import { useSession } from '@/store/session';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppHeader, AppText, Button, Card, ChipRow, Loading, Screen, useToast } from '@/ui';

const THEME_STYLES: Record<
  CardTheme,
  { bg: string; text: string; muted: string; badgeBg: string; badgeText: string; divider: string }
> = {
  gold: {
    bg: '#F6BE25',
    text: '#1B1B1B',
    muted: '#4A3C0B',
    badgeBg: '#1B1B1B',
    badgeText: '#F6BE25',
    divider: 'rgba(27,27,27,0.2)',
  },
  blue: {
    bg: '#1A5DD6',
    text: '#FFFFFF',
    muted: '#DCE8FF',
    badgeBg: '#FFFFFF',
    badgeText: '#1A5DD6',
    divider: 'rgba(255,255,255,0.25)',
  },
  dark: {
    bg: '#1B1B1B',
    text: '#F5F5F5',
    muted: '#BDBDBD',
    badgeBg: '#F6BE25',
    badgeText: '#1B1B1B',
    divider: 'rgba(246,190,37,0.35)',
  },
};

export default function BusinessCardScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const user = useSession((s) => s.user);
  const { shop } = useCurrentShop();

  const [cardTheme, setCardTheme] = useState<CardTheme>('gold');
  const [sharingPdf, setSharingPdf] = useState(false);
  const [printing, setPrinting] = useState(false);

  if (!shop) {
    return (
      <Screen header={<AppHeader title="Business card" />} scroll={false}>
        <Loading label="Loading business card…" />
      </Screen>
    );
  }

  const ownerName = user?.name ?? null;
  const ownerEmail = user?.email ?? null;
  const palette = THEME_STYLES[cardTheme];
  const completion = getProfileCompletion(shop);
  const qrValue = buildCardQrValue(shop, ownerName, ownerEmail);
  const initials = shop.name.trim().slice(0, 2).toUpperCase() || 'SN';

  const handleSharePdf = async () => {
    setSharingPdf(true);
    try {
      const html = buildBusinessCardHtml(shop, ownerName, ownerEmail, cardTheme);
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        toast.show('Sharing is not available on this device', 'error');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `${shop.name} Business Card`,
        UTI: 'com.adobe.pdf',
      });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSharingPdf(false);
    }
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const html = buildBusinessCardHtml(shop, ownerName, ownerEmail, cardTheme);
      await Print.printAsync({ html });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setPrinting(false);
    }
  };

  const handleShareText = async () => {
    const lines = [
      shop.name,
      shop.business_type ? `Category: ${shop.business_type}` : '',
      ownerName ? `Contact: ${ownerName}` : '',
      shop.phone ? `Phone: ${shop.phone}` : '',
      ownerEmail ? `Email: ${ownerEmail}` : '',
      shop.address ? `Address: ${shop.address}` : '',
      shop.online_enabled && shop.slug ? `Online Shop: https://sohannote.app/s/${shop.slug}` : '',
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // User dismissed share
    }
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Business card"
          right={[
            {
              icon: 'pencil-outline',
              label: 'Edit profile',
              onPress: () => router.push('/settings'),
            },
          ]}
        />
      }
    >
      <ChipRow options={CARD_THEMES} value={cardTheme} onChange={setCardTheme} />

      {/* Live Business Card Preview */}
      <View style={[styles.cardPreview, { backgroundColor: palette.bg }]}>
        <View style={styles.cardTop}>
          {shop.logo_uri ? (
            <Image source={{ uri: shop.logo_uri }} style={styles.logoImg} contentFit="cover" />
          ) : (
            <View style={[styles.monogram, { backgroundColor: palette.badgeBg }]}>
              <AppText variant="title" style={{ color: palette.badgeText }}>
                {initials}
              </AppText>
            </View>
          )}
          <View style={styles.flex}>
            <AppText variant="title" style={{ color: palette.text }} numberOfLines={2}>
              {shop.name}
            </AppText>
            {shop.business_type ? (
              <View style={[styles.typeBadge, { backgroundColor: palette.badgeBg }]}>
                <AppText variant="label" bold style={{ color: palette.badgeText }}>
                  {shop.business_type}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: palette.divider }]} />

        <View style={styles.cardBody}>
          <View style={styles.detailsCol}>
            {ownerName ? (
              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="account-outline" size={16} color={palette.text} />
                <AppText variant="secondary" style={{ color: palette.text }} numberOfLines={1}>
                  {ownerName}
                </AppText>
              </View>
            ) : null}
            {shop.phone ? (
              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="phone-outline" size={16} color={palette.text} />
                <AppText variant="secondary" style={{ color: palette.text }} numberOfLines={1}>
                  {shop.phone}
                </AppText>
              </View>
            ) : null}
            {ownerEmail ? (
              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="email-outline" size={16} color={palette.text} />
                <AppText variant="secondary" style={{ color: palette.text }} numberOfLines={1}>
                  {ownerEmail}
                </AppText>
              </View>
            ) : null}
            {shop.address ? (
              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="map-marker-outline" size={16} color={palette.text} />
                <AppText
                  variant="secondary"
                  style={[styles.flex, { color: palette.text }]}
                  numberOfLines={3}
                >
                  {shop.address}
                </AppText>
              </View>
            ) : null}
            {!shop.phone && !shop.address ? (
              <AppText variant="secondary" style={{ color: palette.muted }}>
                Add phone & address in Settings to complete your card.
              </AppText>
            ) : null}
          </View>

          <View style={styles.qrBox}>
            <QRCode value={qrValue} size={80} backgroundColor="#FFFFFF" color="#1B1B1B" />
          </View>
        </View>

        <AppText variant="label" style={[styles.brandFoot, { color: palette.muted }]}>
          {shop.online_enabled && shop.slug
            ? `Scan to visit online store · /s/${shop.slug}`
            : 'Scan QR to save contact · Sohan Note Ultra'}
        </AppText>
      </View>

      {completion.percent < 100 ? (
        <Card style={[styles.nudge, { backgroundColor: colors.primarySoft }]}>
          <View style={styles.flex}>
            <AppText bold>Profile {completion.percent}% complete</AppText>
            <AppText variant="label" muted>
              Missing:{' '}
              {completion.items
                .filter((i) => !i.done)
                .map((i) => i.label)
                .join(', ')}
            </AppText>
          </View>
          <Button label="Complete" variant="outline" onPress={() => router.push('/settings')} />
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Share PDF card"
          icon="file-pdf-box"
          loading={sharingPdf}
          onPress={handleSharePdf}
          fullWidth
        />
        <View style={styles.rowGap}>
          <Button
            label="Print card"
            variant="outline"
            icon="printer-outline"
            loading={printing}
            onPress={handlePrint}
            style={styles.flex}
          />
          <Button
            label="Share text"
            variant="yellow"
            icon="share-variant"
            onPress={handleShareText}
            style={styles.flex}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardPreview: {
    borderRadius: 16,
    padding: 20,
    gap: 14,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logoImg: { width: 58, height: 58, borderRadius: 12 },
  monogram: {
    width: 58,
    height: 58,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: 4,
  },
  divider: { height: 1.5 },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailsCol: { flex: 1, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: 6,
    borderRadius: 8,
  },
  brandFoot: { textAlign: 'right', marginTop: 2 },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  actions: { gap: 10 },
  rowGap: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
