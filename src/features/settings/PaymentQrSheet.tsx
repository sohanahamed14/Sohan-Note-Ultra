import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Role, Shop } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { setPaymentQr } from '@/services/shop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText, BottomSheet, Button, useToast } from '@/ui';
import { pickAndUploadShopImage } from './imageUpload';

export function PaymentQrSheet({
  visible,
  onClose,
  shop,
  role,
}: {
  visible: boolean;
  onClose: () => void;
  shop: Shop;
  role: Role;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const handleUpload = async () => {
    setBusy(true);
    try {
      const picked = await pickAndUploadShopImage(shop.id, 'qr.png');
      if (!picked) return;
      setPaymentQr(db, shop.id, role, picked.uri);
      toast.show(
        picked.uploaded ? 'Payment QR uploaded' : 'Payment QR saved locally',
        'success',
      );
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = () => {
    try {
      setPaymentQr(db, shop.id, role, null);
      toast.show('Payment QR removed', 'info');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="bKash / Nagad Payment QR">
      <AppText variant="secondary" muted>
        Upload your merchant bKash, Nagad, or bank QR image. It will appear automatically on your
        printed and shared PDF invoices.
      </AppText>

      <View
        style={[
          styles.previewBox,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
        ]}
      >
        {shop.payment_qr_uri ? (
          <Image source={{ uri: shop.payment_qr_uri }} style={styles.qrImage} contentFit="contain" />
        ) : (
          <AppText variant="secondary" muted>
            No payment QR uploaded yet
          </AppText>
        )}
      </View>

      <View style={styles.actions}>
        <Button
          label={shop.payment_qr_uri ? 'Replace QR image' : 'Upload QR image'}
          icon="qrcode-plus"
          loading={busy}
          onPress={handleUpload}
          fullWidth
        />
        {shop.payment_qr_uri ? (
          <Button
            label="Remove QR image"
            variant="outline"
            onPress={handleRemove}
            fullWidth
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  previewBox: {
    height: 220,
    borderWidth: 1,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  qrImage: { width: '100%', height: '100%' },
  actions: { gap: 8 },
});
