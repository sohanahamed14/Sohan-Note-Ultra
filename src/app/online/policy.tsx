import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Role, Shop } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { updateShopPolicy } from '@/services/online';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { scheduleSync } from '@/sync';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Loading,
  Screen,
  SectionCard,
  TextField,
  useToast,
} from '@/ui';

const TEMPLATES = [
  {
    label: 'Cash on delivery',
    text: 'Cash on delivery available nationwide.',
  },
  {
    label: 'Check before paying',
    text: 'Please check your parcel in front of the delivery rider before making payment.',
  },
  {
    label: '7-day return',
    text: 'Unused items in original packaging can be exchanged or returned within 7 days.',
  },
  {
    label: 'Delivery time',
    text: 'Inside city delivery within 24–48 hours; outside city 3–5 working days.',
  },
];

function ShopPolicyForm({
  shop,
  shopId,
  role,
}: {
  shop: Shop;
  shopId: string;
  role: Role;
}) {
  const toast = useToast();
  const [policy, setPolicy] = useState(shop.shop_policy ?? '');
  const [saving, setSaving] = useState(false);

  const appendTemplate = (snippet: string) => {
    setPolicy((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return snippet;
      if (trimmed.includes(snippet)) return prev;
      return `${trimmed}\n\n${snippet}`;
    });
  };

  const handleSave = () => {
    setSaving(true);
    try {
      updateShopPolicy(db, {
        shopId,
        role,
        shop_policy: policy.trim() || null,
      });
      scheduleSync(500);
      toast.show('Shop policy saved', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Shop policy" />}>
      <SectionCard title="Quick add clauses">
        <View style={styles.chips}>
          {TEMPLATES.map((t) => (
            <Chip key={t.label} label={`+ ${t.label}`} onPress={() => appendTemplate(t.text)} />
          ))}
        </View>
      </SectionCard>

      <Card style={styles.form}>
        <TextField
          label="Return, refund & delivery policy"
          value={policy}
          onChangeText={setPolicy}
          multiline
          placeholder="Write your store's delivery, return, and warranty terms…"
          helper={`${policy.length} / 5000 characters · Shown on your public storefront`}
          style={styles.textarea}
        />
        {policy.trim() ? (
          <AppText variant="label" muted>
            Tip: Keep terms concise so mobile shoppers can read them quickly.
          </AppText>
        ) : null}
      </Card>

      <Button
        label="Save Shop Policy"
        icon="content-save-outline"
        loading={saving}
        fullWidth
        onPress={handleSave}
      />
    </Screen>
  );
}

export default function ShopPolicyScreen() {
  const { shopId, role, shop } = useCurrentShop();
  const allowed = can(role, 'manageOnline');

  if (!allowed) {
    return (
      <Screen header={<AppHeader title="Shop policy" />} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Permission required"
          message="Only owners and managers can edit the shop policy."
        />
      </Screen>
    );
  }

  if (!shop || !shopId || !role) {
    return (
      <Screen header={<AppHeader title="Shop policy" />} scroll={false}>
        <Loading label="Loading…" />
      </Screen>
    );
  }

  return <ShopPolicyForm key={shop.id} shop={shop} shopId={shopId} role={role} />;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  form: { gap: 8 },
  textarea: { minHeight: 160 },
});
