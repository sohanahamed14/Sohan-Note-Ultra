import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Role, Shop } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { updateDeliveryCharges } from '@/services/online';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { scheduleSync } from '@/sync';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  Divider,
  EmptyState,
  Loading,
  MoneyInput,
  Screen,
  SectionCard,
  useToast,
} from '@/ui';

function DeliveryChargesForm({
  shop,
  shopId,
  role,
}: {
  shop: Shop;
  shopId: string;
  role: Role;
}) {
  const toast = useToast();
  const decimal = shop.decimal_enabled === 1;

  const [inside, setInside] = useState<number | null>(shop.delivery_inside);
  const [outside, setOutside] = useState<number | null>(shop.delivery_outside);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    try {
      updateDeliveryCharges(db, {
        shopId,
        role,
        delivery_inside: inside ?? 0,
        delivery_outside: outside ?? 0,
      });
      scheduleSync(500);
      toast.show('Delivery charges updated', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const inVal = inside ?? 0;
  const outVal = outside ?? 0;

  return (
    <Screen header={<AppHeader title="Delivery charges" />}>
      <Card style={styles.form}>
        <MoneyInput
          label="Inside city delivery charge"
          value={inside}
          onChange={setInside}
          helper="Set 0 for free delivery inside city"
        />
        <MoneyInput
          label="Outside city delivery charge"
          value={outside}
          onChange={setOutside}
          helper="Applied when customers select Outside city at checkout"
        />
      </Card>

      <SectionCard title="Customer checkout preview">
        <View style={styles.previewRow}>
          <AppText>Inside city</AppText>
          <AppText bold>{inVal === 0 ? 'Free' : formatTaka(inVal, decimal)}</AppText>
        </View>
        <Divider />
        <View style={styles.previewRow}>
          <AppText>Outside city</AppText>
          <AppText bold>{outVal === 0 ? 'Free' : formatTaka(outVal, decimal)}</AppText>
        </View>
      </SectionCard>

      <Button
        label="Save Delivery Charges"
        icon="content-save-outline"
        loading={saving}
        fullWidth
        onPress={handleSave}
      />
    </Screen>
  );
}

export default function DeliveryChargesScreen() {
  const { shopId, role, shop } = useCurrentShop();
  const allowed = can(role, 'manageOnline');

  if (!allowed) {
    return (
      <Screen header={<AppHeader title="Delivery charges" />} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Permission required"
          message="Only owners and managers can edit delivery charges."
        />
      </Screen>
    );
  }

  if (!shop || !shopId || !role) {
    return (
      <Screen header={<AppHeader title="Delivery charges" />} scroll={false}>
        <Loading label="Loading…" />
      </Screen>
    );
  }

  return <DeliveryChargesForm key={shop.id} shop={shop} shopId={shopId} role={role} />;
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
});
