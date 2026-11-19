import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { signOutAll } from '@/auth';
import { db } from '@/db/client';
import { BUSINESS_TYPES } from '@/features/settings/EditShopSheet';
import { errorMessage } from '@/lib/errors';
import { createShop } from '@/services/shop';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme';
import { AppHeader, AppText, Button, Card, ChipRow, Screen, TextField, useToast } from '@/ui';

const TYPE_OPTIONS = BUSINESS_TYPES.map((t) => ({ value: t as string, label: t as string }));

export function CreateShopForm({ onboarding }: { onboarding: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();

  const user = useSession((s) => s.user);
  const setShop = useSession((s) => s.setShop);

  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleCreate = () => {
    setError(null);
    if (!user) {
      setError('Please sign in first');
      return;
    }
    setSaving(true);
    try {
      const created = createShop(
        db,
        {
          name,
          business_type: businessType || null,
          phone: phone || null,
          address: address || null,
        },
        { userId: user.id, email: user.email, name: user.name },
      );
      setShop(created.id, 'owner');
      toast.show(`Created "${created.name}"`, 'success');
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      header={
        <AppHeader
          title={onboarding ? 'Set up your shop' : 'Create new shop'}
          back={!onboarding}
          right={
            onboarding
              ? [
                  {
                    icon: 'logout',
                    label: 'Sign out',
                    onPress: () => {
                      void signOutAll();
                    },
                  },
                ]
              : []
          }
        />
      }
    >
      <Card style={styles.card}>
        <AppText variant="title">Tell us about your business</AppText>
        <AppText variant="secondary" muted>
          This information appears on your invoices, online store, and digital business card.
        </AppText>

        <TextField
          label="Shop name *"
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (error) setError(null);
          }}
          placeholder="e.g. Satarkul Gas Store"
          autoFocus
        />

        <View style={styles.block}>
          <AppText variant="secondary" muted>
            Business type
          </AppText>
          <ChipRow<string> options={TYPE_OPTIONS} value={businessType} onChange={setBusinessType} />
          <TextField
            value={businessType}
            onChangeText={setBusinessType}
            placeholder="Or enter custom type (e.g. Bakery, Mobile Shop)"
          />
        </View>

        <TextField
          label="Business phone"
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
          placeholder="Market / road / area / city"
        />

        {error ? (
          <AppText variant="secondary" style={{ color: colors.danger }}>
            {error}
          </AppText>
        ) : null}

        <Button
          label={onboarding ? 'Create shop & continue' : 'Create shop'}
          variant="yellow"
          icon="store-plus-outline"
          loading={saving}
          onPress={handleCreate}
          fullWidth
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  block: { gap: 6 },
});
