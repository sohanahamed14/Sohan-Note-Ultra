import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Method } from '@/db/schema';
import {
  endOfDay,
  endOfMonth,
  formatDateTime,
  now,
  startOfDay,
  startOfMonth,
} from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { can } from '@/services/permissions';
import { listPurchases, type PurchaseListResult } from '@/services/purchases';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { useTableRevision } from '@/features/products/useTableRevision';
import {
  AppHeader,
  AppText,
  Badge,
  Card,
  ChipRow,
  DateField,
  EmptyState,
  Fab,
  ListRow,
  Loading,
  Screen,
  SearchBar,
  Segmented,
} from '@/ui';

type DatePreset = 'today' | 'month' | 'all' | 'custom';
type StatusFilter = 'all' | 'paid' | 'due';

const DATE_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
];

const METHOD_LABELS: Record<Method, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

const WATCHED_TABLES = ['purchases', 'purchase_items', 'parties'] as const;

export default function PurchasesLedgerScreen() {
  const { shopId, role, shop } = useCurrentShop();
  const { colors } = useTheme();
  const { rev } = useTableRevision(WATCHED_TABLES);

  const [preset, setPreset] = useState<DatePreset>('month');
  const [fromDate, setFromDate] = useState(() => startOfMonth(now()));
  const [toDate, setToDate] = useState(() => endOfDay(now()));
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const canBuy = can(role, 'buy');
  const decimal = shop?.decimal_enabled === 1;

  const range = useMemo<{ from?: number; to?: number }>(() => {
    const t = now();
    if (preset === 'today') return { from: startOfDay(t), to: endOfDay(t) };
    if (preset === 'month') return { from: startOfMonth(t), to: endOfMonth(t) };
    if (preset === 'custom') return { from: startOfDay(fromDate), to: endOfDay(toDate) };
    return {};
  }, [preset, fromDate, toDate]);

  const { result, error } = useMemo<{
    result: PurchaseListResult | null;
    error: string | null;
  }>(() => {
    if (!shopId || !canBuy) return { result: null, error: null };
    void rev;
    try {
      const data = listPurchases(db, shopId, {
        from: range.from,
        to: range.to,
        status,
        search,
      });
      return { result: data, error: null };
    } catch (e) {
      return { result: null, error: errorMessage(e) };
    }
  }, [shopId, canBuy, rev, range.from, range.to, status, search]);

  const header = (
    <AppHeader
      title="Purchase ledger"
      right={
        canBuy
          ? [{ icon: 'plus', label: 'New purchase', onPress: () => router.push('/buy') }]
          : []
      }
    />
  );

  if (!shopId) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading purchases…" />
      </Screen>
    );
  }

  if (!canBuy) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Restricted"
          message="Only owners and managers can view the purchase ledger."
        />
      </Screen>
    );
  }

  const totals = result?.totals ?? { count: 0, total: 0, paid: 0, due: 0 };

  return (
    <Screen
      header={header}
      scroll={false}
      padded={false}
      overlay={<Fab label="New purchase" onPress={() => router.push('/buy')} />}
    >
      <View style={styles.top}>
        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.flex}>
              <AppText variant="label" muted>
                Total purchases ({totals.count})
              </AppText>
              <AppText variant="title" style={{ color: colors.accent }}>
                {formatTaka(totals.total, decimal)}
              </AppText>
            </View>
            <View style={styles.statPair}>
              <View style={[styles.statPill, { backgroundColor: colors.surfaceMuted }]}>
                <AppText variant="label" muted>
                  Paid
                </AppText>
                <AppText variant="secondary" bold style={{ color: colors.success }}>
                  {formatTaka(totals.paid, decimal)}
                </AppText>
              </View>
              <View style={[styles.statPill, { backgroundColor: colors.surfaceMuted }]}>
                <AppText variant="label" muted>
                  Due
                </AppText>
                <AppText
                  variant="secondary"
                  bold
                  style={{ color: totals.due > 0 ? colors.danger : colors.textMuted }}
                >
                  {formatTaka(totals.due, decimal)}
                </AppText>
              </View>
            </View>
          </View>
        </Card>

        <ChipRow options={DATE_OPTIONS} value={preset} onChange={setPreset} />

        {preset === 'custom' ? (
          <View style={styles.dateRow}>
            <View style={styles.flex}>
              <DateField label="From" value={fromDate} onChange={setFromDate} />
            </View>
            <View style={styles.flex}>
              <DateField label="To" value={toDate} onChange={setToDate} />
            </View>
          </View>
        ) : null}

        <View style={styles.searchRow}>
          <View style={styles.flex}>
            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder="Search bill no or supplier"
            />
          </View>
        </View>

        <Segmented<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'paid', label: 'Paid' },
            { value: 'due', label: 'Due' },
          ]}
        />
      </View>

      {error ? (
        <View style={styles.pad}>
          <Card>
            <EmptyState
              icon="alert-circle-outline"
              title="Failed to load purchases"
              message={error}
            />
          </Card>
        </View>
      ) : (
        <FlatList
          data={result?.items ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="receipt-text-outline"
              title="No purchases found"
              message={
                search || status !== 'all'
                  ? 'Try another filter or date range.'
                  : 'Record your first stock purchase to see it here.'
              }
              action={
                !search && status === 'all'
                  ? { label: 'Record buy', onPress: () => router.push('/buy') }
                  : undefined
              }
            />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.supplierName ?? 'Walk-in Supplier'}
              subtitle={`${item.bill_no} · ${formatDateTime(item.date)} · ${item.itemCount} item${item.itemCount === 1 ? '' : 's'} · ${METHOD_LABELS[item.method]}`}
              right={
                <View style={styles.rightCol}>
                  <AppText bold>{formatTaka(item.total, decimal)}</AppText>
                  {item.due > 0 ? (
                    <Badge label={`Due ${formatTaka(item.due, decimal)}`} tone="danger" />
                  ) : (
                    <Badge label="Paid" tone="success" />
                  )}
                </View>
              }
              onPress={() =>
                router.push({ pathname: '/purchases/[id]', params: { id: item.id } })
              }
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  summaryCard: { gap: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  statPair: { flexDirection: 'row', gap: 8 },
  statPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.row, gap: 2 },
  dateRow: { flexDirection: 'row', gap: 10 },
  searchRow: { flexDirection: 'row', gap: 8 },
  pad: { padding: 16 },
  listContent: { flexGrow: 1, paddingBottom: 88 },
  rightCol: { alignItems: 'flex-end', gap: 4 },
});
