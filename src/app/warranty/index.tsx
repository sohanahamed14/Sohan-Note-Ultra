import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { parties, sale_items, sales } from '@/db/schema';
import { formatDate } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { listWarrantyItems, type WarrantyItem } from '@/services/warranty';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppHeader,
  AppText,
  Badge,
  Card,
  EmptyState,
  Loading,
  Screen,
  SearchBar,
  Segmented,
  useToast,
} from '@/ui';

type StatusFilter = 'active' | 'expired' | 'all';

function formatWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('01')) return `88${digits}`;
  return digits;
}

export default function WarrantyScreen() {
  const { colors } = useTheme();
  const { shopId } = useCurrentShop();
  const toast = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');

  const { updatedAt: itemsUpdated, error: itemsErr } = useLiveQuery(
    expoDb
      .select({ id: sale_items.id })
      .from(sale_items)
      .where(active(sale_items, shopId ?? '')),
    [shopId],
  );
  const { updatedAt: salesUpdated, error: salesErr } = useLiveQuery(
    expoDb.select({ id: sales.id }).from(sales).where(active(sales, shopId ?? '')),
    [shopId],
  );
  const { updatedAt: partiesUpdated } = useLiveQuery(
    expoDb.select({ id: parties.id }).from(parties).where(active(parties, shopId ?? '')),
    [shopId],
  );

  const { items, summary } = useMemo(() => {
    if (!shopId) {
      return {
        items: [] as WarrantyItem[],
        summary: { total: 0, active: 0, expiring: 0, expired: 0 },
      };
    }
    void itemsUpdated;
    void salesUpdated;
    void partiesUpdated;
    return listWarrantyItems(db, shopId, { status: statusFilter, search });
  }, [shopId, statusFilter, search, itemsUpdated, salesUpdated, partiesUpdated]);

  const queryErr = itemsErr ?? salesErr;

  if (!shopId) {
    return (
      <Screen header={<AppHeader title="Warranty" />} scroll={false}>
        <Loading label="Loading warranty records..." />
      </Screen>
    );
  }

  const handleCall = async (phone: string) => {
    try {
      await Linking.openURL(`tel:${phone}`);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleWhatsApp = async (item: WarrantyItem) => {
    if (!item.customerPhone) return;
    const msg = `Hello ${item.customerName ?? ''}, warranty info for ${item.productName} (Invoice ${item.invoiceNo}): valid until ${formatDate(item.warrantyUntil)}.`;
    const url = `https://wa.me/${formatWhatsAppPhone(item.customerPhone)}?text=${encodeURIComponent(msg)}`;
    try {
      await Linking.openURL(url);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <Screen header={<AppHeader title="Warranty" />} scroll={false} padded={false}>
      <View style={styles.controls}>
        <Card style={styles.summaryCard}>
          <View style={styles.statCol}>
            <AppText variant="label" muted>
              Active
            </AppText>
            <AppText variant="title" style={{ color: colors.success }}>
              {summary.active}
            </AppText>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.statCol}>
            <AppText variant="label" muted>
              Expiring ≤30d
            </AppText>
            <AppText variant="title" style={{ color: colors.primary }}>
              {summary.expiring}
            </AppText>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.statCol}>
            <AppText variant="label" muted>
              Expired
            </AppText>
            <AppText variant="title" style={{ color: colors.danger }}>
              {summary.expired}
            </AppText>
          </View>
        </Card>

        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search customer, phone, product, invoice..."
        />

        <Segmented
          options={[
            { value: 'active', label: 'Active' },
            { value: 'expired', label: 'Expired' },
            { value: 'all', label: 'All' },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </View>

      {queryErr ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load warranties"
          message={queryErr.message}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.saleItemId}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="shield-check-outline"
              title="No warranty items"
              message={
                search
                  ? 'No warranty records match your search.'
                  : 'Sold products with warranty days configured will appear here.'
              }
            />
          }
          renderItem={({ item }) => {
            const tone =
              item.status === 'expired'
                ? 'danger'
                : item.status === 'expiring'
                  ? 'warning'
                  : 'success';
            const badgeLabel =
              item.status === 'expired'
                ? `Expired ${Math.abs(item.daysRemaining)}d ago`
                : item.daysRemaining === 0
                  ? 'Expires today'
                  : `${item.daysRemaining}d left`;

            return (
              <Card style={styles.itemCard}>
                <View style={styles.rowTop}>
                  <View style={styles.flex}>
                    <AppText bold numberOfLines={1}>
                      {item.productName}
                      {item.qty !== 1 ? ` × ${item.qty}` : ''}
                    </AppText>
                    <AppText variant="label" muted>
                      {item.customerName ?? 'Walk-in Customer'}
                      {item.customerPhone ? ` · ${item.customerPhone}` : ''}
                    </AppText>
                  </View>
                  <Badge label={badgeLabel} tone={tone} />
                </View>

                <View style={styles.datesRow}>
                  <AppText variant="label" muted>
                    Sold: {formatDate(item.saleDate)}
                  </AppText>
                  <AppText
                    variant="label"
                    bold
                    style={{
                      color: item.status === 'expired' ? colors.danger : colors.accent,
                    }}
                  >
                    Until: {formatDate(item.warrantyUntil)}
                  </AppText>
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({ pathname: '/invoice/[id]', params: { id: item.saleId } })
                    }
                    style={[styles.actionPill, { backgroundColor: colors.surfaceMuted }]}
                  >
                    <MaterialCommunityIcons
                      name="receipt-text-outline"
                      size={16}
                      color={colors.accent}
                    />
                    <AppText variant="label" bold style={{ color: colors.accent }}>
                      {item.invoiceNo}
                    </AppText>
                  </Pressable>

                  {item.customerPhone ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => handleCall(item.customerPhone ?? '')}
                        style={[styles.actionPill, { backgroundColor: colors.surfaceMuted }]}
                      >
                        <MaterialCommunityIcons
                          name="phone-outline"
                          size={16}
                          color={colors.text}
                        />
                        <AppText variant="label" bold>
                          Call
                        </AppText>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => handleWhatsApp(item)}
                        style={[styles.actionPill, { backgroundColor: colors.surfaceMuted }]}
                      >
                        <MaterialCommunityIcons
                          name="whatsapp"
                          size={16}
                          color={colors.success}
                        />
                        <AppText variant="label" bold style={{ color: colors.success }}>
                          WhatsApp
                        </AppText>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, gap: 10 },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  statCol: { flex: 1, alignItems: 'center', gap: 2 },
  statDiv: { width: 1, height: 28 },
  listContent: { padding: 12, gap: 10, flexGrow: 1 },
  itemCard: { gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  datesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  flex: { flex: 1 },
});
