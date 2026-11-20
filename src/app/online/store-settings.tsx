import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Role, Shop } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import {
  buildStorefrontUrl,
  normalizeSlug,
  updateStoreSettings,
} from '@/services/online';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { detectImageFormat, scheduleSync, uploadShopImage } from '@/sync';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  EmptyState,
  Loading,
  Screen,
  SettingsRow,
  TextField,
  useToast,
} from '@/ui';

function StoreSettingsForm({
  shop,
  shopId,
  role,
}: {
  shop: Shop;
  shopId: string;
  role: Role;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [name, setName] = useState(shop.name);
  const [slug, setSlug] = useState(shop.slug ?? '');
  const [phone, setPhone] = useState(shop.phone ?? '');
  const [address, setAddress] = useState(shop.address ?? '');
  const [businessType, setBusinessType] = useState(shop.business_type ?? '');
  const [logoUri, setLogoUri] = useState<string | null>(shop.logo_uri ?? null);
  const [onlineEnabled, setOnlineEnabled] = useState(shop.online_enabled === 1);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const previewSlug = normalizeSlug(slug);
  const previewUrl = previewSlug ? buildStorefrontUrl(previewSlug) : null;

  const handlePickLogo = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const localUri = res.assets[0].uri;
      setUploading(true);
      try {
        const { ext } = detectImageFormat(localUri);
        const publicUrl = await uploadShopImage(shopId, localUri, `logo.${ext}`);
        setLogoUri(publicUrl);
        toast.show('Logo uploaded', 'success');
      } catch {
        // Offline fallback: save local URI and let sync engine upload when back online.
        setLogoUri(localUri);
        toast.show('Logo saved locally; will upload on next sync', 'info');
      } finally {
        setUploading(false);
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleSave = () => {
    setSaving(true);
    try {
      const saved = updateStoreSettings(db, {
        shopId,
        role,
        name: name.trim(),
        slug: slug.trim() === '' ? null : slug,
        phone: phone.trim() || null,
        address: address.trim() || null,
        business_type: businessType.trim() || null,
        logo_uri: logoUri,
        online_enabled: onlineEnabled,
      });
      setSlug(saved.slug ?? '');
      setOnlineEnabled(saved.online_enabled === 1);
      scheduleSync(500);
      toast.show('Store settings saved', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Store settings" />}>
      <SettingsRow
        icon="storefront-outline"
        label="Enable Online Shop"
        kind="switch"
        value={onlineEnabled}
        onValueChange={setOnlineEnabled}
      />

      <Card style={styles.logoCard}>
        <AppText variant="secondary" muted>
          Shop Logo
        </AppText>
        <View style={styles.logoRow}>
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={styles.logoImg} />
          ) : (
            <View style={[styles.logoPlaceholder, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="store-outline" size={32} color={colors.textMuted} />
            </View>
          )}
          <View style={styles.logoActions}>
            <Button
              label={logoUri ? 'Change logo' : 'Upload logo'}
              icon="image-plus"
              variant="outline"
              loading={uploading}
              onPress={() => void handlePickLogo()}
            />
            {logoUri ? (
              <Button
                label="Remove"
                variant="ghost"
                onPress={() => setLogoUri(null)}
              />
            ) : null}
          </View>
        </View>
      </Card>

      <Card style={styles.formCard}>
        <TextField
          label="Shop name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Sohan Electronics"
        />
        <TextField
          label="Storefront link (slug)"
          value={slug}
          onChangeText={setSlug}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. sohan-electronics"
          helper={
            previewUrl
              ? `Public URL: ${previewUrl}`
              : '3–50 lowercase letters, numbers, or hyphens'
          }
        />
        <TextField
          label="Phone / WhatsApp number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="01XXXXXXXXX"
          helper="Customers send WhatsApp order confirmations to this number"
        />
        <TextField
          label="Business type"
          value={businessType}
          onChangeText={setBusinessType}
          placeholder="e.g. Grocery, Electronics, Fashion"
        />
        <TextField
          label="Shop address"
          value={address}
          onChangeText={setAddress}
          multiline
          placeholder="House, road, area, city"
        />
      </Card>

      <Button
        label="Save Store Settings"
        icon="content-save-outline"
        loading={saving}
        fullWidth
        onPress={handleSave}
      />
    </Screen>
  );
}

export default function StoreSettingsScreen() {
  const { shopId, role, shop } = useCurrentShop();
  const allowed = can(role, 'manageOnline');

  if (!allowed) {
    return (
      <Screen header={<AppHeader title="Store settings" />} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Permission required"
          message="Only owners and managers can edit store settings."
        />
      </Screen>
    );
  }

  if (!shop || !shopId || !role) {
    return (
      <Screen header={<AppHeader title="Store settings" />} scroll={false}>
        <Loading label="Loading store…" />
      </Screen>
    );
  }

  return <StoreSettingsForm key={shop.id} shop={shop} shopId={shopId} role={role} />;
}

const styles = StyleSheet.create({
  logoCard: { gap: 10 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logoImg: { width: 68, height: 68, borderRadius: radius.card },
  logoPlaceholder: {
    width: 68,
    height: 68,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoActions: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formCard: { gap: 12 },
});
