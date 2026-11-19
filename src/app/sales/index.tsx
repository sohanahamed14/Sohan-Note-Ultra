import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { METHODS, parties, sales, type Method } from '@/db/schema';
import { endOfDay, endOfMonth, formatDateTime, now, startOfDay, startOfMonth } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { add, formatTaka, mulQty } from '@/lib/money';
import { CollectDueSheet } from '@/features/sell/CollectDueSheet';
import { formatMethodLabel } from '@/services/invoice';
import { can } from '@/services/permissions';
import {
  deleteSale,
  getSaleById,
  listSales,
  type SaleListItem,
  type SalePaymentStatus,
} from '@/services/sales';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AmountText,
  AppHeader,
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  ChipRow,
  ConfirmDialog,
  DateField,
  Divider,
  EmptyState,
  Fab,
  Loading,
  Screen,
  SearchBar,
  useToast,
} from '@/ui';

type DatePreset = 'today' | 'month' | 'all' | 'custom';

const DATE_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_OPTIONS: { value: 'all' | SalePaymentStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'partial', label: 'Partial' },
  { value: 'due', label: 'Due' },
];

const METHOD_OPTIONS: { value: 'all' | Method; label: string }[] = [
  { value: 'all', label: 'All Methods' },
  ...METHODS.map((m) => ({ value: m, label: formatMethodLabel(m) })),
];

export default function SalesLedgerScreen() {
  const { colors } = useTheme();
  const { shopId, role, shop, requireShop } = useCurrentShop();
  const toast = useToast();
  const dec = Boolean(shop?.decimal_enabled);

  const [preset, setPreset] = useState<DatePreset>('month');
  const [fromDate, setFromDate] = useState<number>(() => startOfMonth(now()));
  const [toDate, setToDate] = useState<number>(() => endOfDay(now()));
  const [status, setStatus] = useState<'all' | SalePaymentStatus>('all');
  const [method, setMethod] = useState<'all' | Method>('all');
  const [search, setSearch] = useState('');

  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [collectTarget, setCollectTarget] = useState<SaleListItem | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const { updatedAt: salesUpdated, error: salesErr } = useLiveQuery(
    expoDb
      .select({ id: sales.id, updated_at: sales.updated_at })
      .from(sales)
      .where(active(sales, shopId ?? '')),
    [shopId],
  );
  const { updatedAt: partyUpdated } = useLiveQuery(
    expoDb.select({ id: parties.id }).from(parties).where(active(parties, shopId ?? '')),
    [shopId],
  );

  const range = useMemo(() => {
    const t = now();
    if (preset === 'today') return { from: startOfDay(t), to: endOfDay(t) };
    if (preset === 'month') return { from: startOfMonth(t), to: endOfMonth(t) };
    if (preset === 'custom') return { from: startOfDay(fromDate), to: endOfDay(toDate) };
    return { from: undefined, to: undefined };
  }, [preset, fromDate, toDate]);

  const { rows, totals } = useMemo(() => {
    if (!shopId) return { rows: [] as SaleListItem[], totals: { count: 0, total: 0, paid: 0, due: 0 } };
    void salesUpdated;
    void partyUpdated;
    return listSales(db, shopId, {
      fromDate: range.from,
      toDate: range.to,
      status,
      method,
      search,
    });
  }, [shopId, range.from, range.to, status, method, search, salesUpdated, partyUpdated]);

  const selectedDetail = useMemo(() => {
    if (!shopId || !selectedSaleId) return null;
    void salesUpdated;
    return getSaleById(db, shopId, selectedSaleId);
  }, [shopId, selectedSaleId, salesUpdated]);

  const canSell = can(role, 'sell');
  const canDelete = can(role, 'delete');
  const canCollect = can(role, 'collectDue');
  const canSeeProfit = can(role, 'viewProfit') && can(role, 'viewCost');

  const selectedProfit = useMemo(() => {
    if (!selectedDetail || !canSeeProfit) return null;
    const cogs = add(...selectedDetail.items.map((i) => mulQty(i.buy_price, i.qty)));
    const netRevenue = selectedDetail.sale.subtotal - selectedDetail.sale.discount;
    return { cogs, profit: netRevenue - cogs };
  }, [selectedDetail, canSeeProfit]);

  if (!shopId || !role) {
    return (
      <Screen header={<AppHeader title="Sales ledger" />} scroll={false}>
        <Loading label="Loading sales..." />
      </Screen>
    );
  }

  const handleDelete = () => {
    if (!deleteTargetId) return;
    try {
      const ctx = requireShop();
      deleteSale(db, ctx, deleteTargetId);
      setDeleteTargetId(null);
      setSelectedSaleId(null);
      toast.show('Sale moved to Recycle Bin', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Sales ledger"
          right={
            canSell
              ? [{ icon: 'cart-plus', label: 'New sale', onPress: () => router.push('/sell') }]
              : []
          }
        />
      }
      scroll={false}
      padded={false}
      overlay={
        canSell ? <Fab label="New sale" icon="plus" onPress={() => router.push('/sell')} /> : null
      }
    >
      <View style={styles.filters}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Invoice #, customer, phone..." />
        <ChipRow options={DATE_OPTIONS} value={preset} onChange={setPreset} />
        {preset === 'custom' ? (
          <View style={styles.customDates}>
            <View style={styles.flex}>
              <DateField label="From" value={fromDate} onChange={setFromDate} />
            </View>
            <View style={styles.flex}>
              <DateField label="To" value={toDate} onChange={setToDate} />
            </View>
          </View>
        ) : null}
        <ChipRow options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <ChipRow options={METHOD_OPTIONS} value={method} onChange={setMethod} />

        {/* Summary Totals */}
        <Card style={styles.totalsCard}>
          <View style={styles.statCol}>
            <AppText variant="label" muted>
              Sales ({totals.count})
            </AppText>
            <AmountText paisa={totals.total} decimal={dec} variant="secondary" />
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.statCol}>
            <AppText variant="label" muted>
              Received
            </AppText>
            <AmountText paisa={totals.paid} decimal={dec} tone="positive" variant="secondary" />
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.statCol}>
            <AppText variant="label" muted>
              Due
            </AppText>
            <AmountText
              paisa={totals.due}
              decimal={dec}
              tone={totals.due > 0 ? 'negative' : 'neutral'}
              variant="secondary"
            />
          </View>
        </Card>
      </View>

      {salesErr ? (
        <EmptyState icon="alert-circle-outline" title="Failed to load sales" message={salesErr.message} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="receipt-text-outline"
              title="No sales found"
              message="Try changing the date range or filters, or create a new sale."
              action={
                canSell ? { label: 'New Sale', onPress: () => router.push('/sell') } : undefined
              }
            />
          }
          renderItem={({ item }) => {
            const tone =
              item.paymentStatus === 'paid'
                ? 'success'
                : item.paymentStatus === 'partial'
                  ? 'warning'
                  : 'danger';
            const badgeText =
              item.paymentStatus === 'paid'
                ? 'Paid'
                : item.paymentStatus === 'partial'
                  ? 'Partial'
                  : 'Due';

            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedSaleId(item.id)}
                style={[
                  styles.saleCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.rowTop}>
                  <View style={styles.titleRow}>
                    <AppText bold>{item.invoice_no}</AppText>
                    <Badge label={badgeText} tone={tone} />
                    {item.kind !== 'pos' ? (
                      <Badge label={item.kind.toUpperCase()} tone="neutral" />
                    ) : null}
                  </View>
                  <AmountText paisa={item.total} decimal={dec} />
                </View>

                <View style={styles.rowMid}>
                  <AppText variant="label" muted numberOfLines={1} style={styles.flex}>
                    {item.partyName ?? 'Walk-in'} · {formatDateTime(item.date)} ·{' '}
                    {formatMethodLabel(item.method)}
                  </AppText>
                  <AppText variant="label" muted>
                    {item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}
                  </AppText>
                </View>

                {item.due > 0 ? (
                  <View style={styles.rowBottom}>
                    <AppText variant="label" style={{ color: colors.success }}>
                      Paid {formatTaka(item.paid, dec)}
                    </AppText>
                    <AppText variant="label" bold style={{ color: colors.danger }}>
                      Due {formatTaka(item.due, dec)}
                    </AppText>
                    {canCollect ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setCollectTarget(item)}
                        style={[styles.collectPill, { backgroundColor: colors.primarySoft }]}
                      >
                        <AppText variant="label" bold style={{ color: colors.onPrimary }}>
                          Collect due
                        </AppText>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}

      {/* Sale Detail Sheet */}
      <BottomSheet
        visible={Boolean(selectedDetail)}
        onClose={() => setSelectedSaleId(null)}
        title={selectedDetail?.sale.invoice_no ?? 'Sale Details'}
      >
        {selectedDetail ? (
          <ScrollView contentContainerStyle={styles.detailBody}>
            <View style={styles.detailMeta}>
              <AppText variant="secondary" bold>
                {selectedDetail.party ? selectedDetail.party.name : 'Walk-in Customer'}
              </AppText>
              <AppText variant="label" muted>
                {formatDateTime(selectedDetail.sale.date)} ·{' '}
                {formatMethodLabel(selectedDetail.sale.method)} ·{' '}
                {selectedDetail.sale.kind.toUpperCase()}
              </AppText>
            </View>

            <Divider />

            {selectedDetail.items.map((it) => (
              <View key={it.id} style={styles.detailItem}>
                <View style={styles.flex}>
                  <AppText variant="secondary" bold>
                    {it.name}
                  </AppText>
                  <AppText variant="label" muted>
                    {it.qty} × {formatTaka(it.unit_price, dec)}
                  </AppText>
                </View>
                <AmountText paisa={it.total} decimal={dec} variant="secondary" />
              </View>
            ))}

            <Divider />

            <View style={styles.detailTotals}>
              <View style={styles.rowTop}>
                <AppText variant="secondary" muted>
                  Total
                </AppText>
                <AmountText paisa={selectedDetail.sale.total} decimal={dec} />
              </View>
              <View style={styles.rowTop}>
                <AppText variant="secondary" style={{ color: colors.success }}>
                  Paid
                </AppText>
                <AmountText
                  paisa={selectedDetail.sale.paid}
                  decimal={dec}
                  tone="positive"
                  variant="secondary"
                />
              </View>
              {selectedDetail.sale.due > 0 ? (
                <View style={styles.rowTop}>
                  <AppText variant="secondary" style={{ color: colors.danger }}>
                    Due
                  </AppText>
                  <AmountText
                    paisa={selectedDetail.sale.due}
                    decimal={dec}
                    tone="negative"
                    variant="secondary"
                  />
                </View>
              ) : null}
              {selectedProfit ? (
                <View style={styles.rowTop}>
                  <AppText variant="label" muted>
                    Est. Profit (Cost: {formatTaka(selectedProfit.cogs, dec)})
                  </AppText>
                  <AmountText
                    paisa={selectedProfit.profit}
                    decimal={dec}
                    tone="auto"
                    variant="label"
                  />
                </View>
              ) : null}
            </View>

            {selectedDetail.sale.note ? (
              <AppText variant="label" muted>
                Note: {selectedDetail.sale.note}
              </AppText>
            ) : null}

            <View style={styles.detailActions}>
              <Button
                label="View Invoice"
                icon="receipt-text-outline"
                variant="primary"
                onPress={() => {
                  const id = selectedDetail.sale.id;
                  setSelectedSaleId(null);
                  router.push({ pathname: '/invoice/[id]', params: { id } });
                }}
                style={styles.flex}
              />
              {selectedDetail.sale.due > 0 && canCollect ? (
                <Button
                  label="Collect Due"
                  icon="cash-plus"
                  variant="yellow"
                  onPress={() => {
                    const matched = rows.find((r) => r.id === selectedDetail.sale.id);
                    setSelectedSaleId(null);
                    setCollectTarget(
                      matched ?? {
                        ...selectedDetail.sale,
                        partyName: selectedDetail.party?.name ?? null,
                        partyPhone: selectedDetail.party?.phone ?? null,
                        itemCount: selectedDetail.items.length,
                        paymentStatus: selectedDetail.sale.paid > 0 ? 'partial' : 'due',
                      },
                    );
                  }}
                  style={styles.flex}
                />
              ) : null}
            </View>

            {canDelete ? (
              <Button
                label="Delete Sale"
                icon="delete-outline"
                variant="danger"
                fullWidth
                onPress={() => setDeleteTargetId(selectedDetail.sale.id)}
              />
            ) : null}
          </ScrollView>
        ) : null}
      </BottomSheet>

      <CollectDueSheet
        sale={collectTarget}
        customerName={collectTarget?.partyName}
        onClose={() => setCollectTarget(null)}
      />

      <ConfirmDialog
        visible={Boolean(deleteTargetId)}
        title="Delete Sale?"
        message="Move this sale to Recycle Bin? Stock, cash, and customer due will be reversed."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, gap: 6 },
  customDates: { flexDirection: 'row', gap: 8 },
  totalsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  statCol: { flex: 1, alignItems: 'center', gap: 2 },
  statDiv: { width: 1, height: 28 },
  listContent: { padding: 12, gap: 8, paddingBottom: 88, flexGrow: 1 },
  saleCard: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 12,
    gap: 6,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 },
  rowMid: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  collectPill: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  detailBody: { gap: 10, paddingBottom: 8 },
  detailMeta: { gap: 2 },
  detailItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  detailTotals: { gap: 6 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
});
