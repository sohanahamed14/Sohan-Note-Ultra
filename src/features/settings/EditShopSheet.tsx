import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Role, Shop } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { updateShop } from '@/services/shop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText, BottomSheet, Button, ChipRow, TextField, useToast } from '@/ui';
import { pickAndUploadShopImage } from './imageUpload';

export const BUSINESS_TYPES = [
  'Grocery',
  'Gas & Fuel',
  'Electronics',
  'Fashion',
  'Pharmacy',
  'Hardware',
  'Restaurant',
  'Services',
  'Wholesale',
  'Other',
] as const;

const TYPE_OPTIONS = BUSINESS_TYPES.map((t) => ({ value: t as string, label: t as string }));

function EditShopBody({
  shop,
  role,
  onClose,
}: {
  shop: Shop;
  role: Role;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [name, setName] = useState(shop.name);
  const [businessType, setBusinessType] = useState(shop.business_type ?? '');
  const [phone, setPhone] = useState(shop.phone ?? '');
  const [address, setAddress] = useState(shop.address ?? '');
  const [vat, setVat] = useState(String(shop.vat_percent || 0));
  const [footer, setFooter] = useState(shop.invoice_footer ?? '');
  const [logoUri, setLogoUri] = useState<string | null>(shop.logo_uri);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickLogo = async () => {
    setUploading(true);
    try {
      const picked = await pickAndUploadShopImage(shop.id, 'logo.png');
      if (picked) {
        setLogoUri(picked.uri);
        toast.show(picked.uploaded ? 'Logo uploaded' : 'Logo selected locally', 'success');
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    setError(null);
    const vatNum = Number(vat.trim() || '0');
    if (!Number.isFinite(vatNum) || vatNum < 0 || vatNum > 100) {
      setError('VAT must be between 0 and 100');
      return;
    }
    setSaving(true);
    try {
      updateShop(db, shop.id, role, {
        name,
        business_type: businessType || null,
        phone: phone || null,
        address: address || null,
        vat_percent: vatNum,
        invoice_footer: footer || null,
        logo_uri: logoUri,
      });
      toast.show('Shop profile updated', 'success');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
      <View style={styles.logoRow}>
        {logoUri ? (
          <Image source={{ uri: logoUri }} style={styles.logoImg} contentFit="cover" />
        ) : (
          <View style={[styles.logoPlaceholder, { backgroundColor: colors.primarySoft }]}>
            <AppText variant="title" style={{ color: colors.onPrimary }}>
              {name.trim().slice(0, 2).toUpperCase() || 'SN'}
            </AppText>
          </View>
        )}
        <View style={styles.logoActions}>
          <Button
            label={logoUri ? 'Change logo' : 'Upload logo'}
            variant="outline"
            icon="image-plus"
            loading={uploading}
            onPress={handlePickLogo}
          />
          {logoUri ? (
            <Button label="Remove" variant="ghost" onPress={() => setLogoUri(null)} />
          ) : null}
        </View>
      </View>

      <TextField
        label="Shop name *"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Satarkul Gas Store"
      />

      <View style={styles.chipBlock}>
        <AppText variant="secondary" muted>
          Business type
        </AppText>
        <ChipRow<string> options={TYPE_OPTIONS} value={businessType} onChange={setBusinessType} />
        <TextField
          value={businessType}
          onChangeText={setBusinessType}
          placeholder="Or type custom business category"
        />
      </View>

      <TextField
        label="Phone number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="e.g. +8801840673882"
      />

      <TextField
        label="Shop address"
        value={address}
        onChangeText={setAddress}
        multiline
        placeholder="Street, area, city"
      />

      <TextField
        label="Default VAT (%)"
        value={vat}
        onChangeText={setVat}
        keyboardType="decimal-pad"
        placeholder="0"
      />

      <TextField
        label="Invoice footer note"
        value={footer}
        onChangeText={setFooter}
        placeholder="e.g. Goods once sold are not refundable."
      />

      {error ? (
        <AppText variant="secondary" style={{ color: colors.danger }}>
          {error}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
        <Button label="Save changes" loading={saving} onPress={handleSave} style={styles.flex} />
      </View>
    </ScrollView>
  );
}

export function EditShopSheet({
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
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Edit shop profile">
      {visible ? (
        <EditShopBody
          key={`${shop.id}-${shop.updated_at}`}
          shop={shop}
          role={role}
          onClose={onClose}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, paddingBottom: 16 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoImg: { width: 64, height: 64, borderRadius: radius.card },
  logoPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoActions: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipBlock: { gap: 6 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
