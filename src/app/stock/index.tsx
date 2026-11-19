import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { StockMovement } from '@/db/schema';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { can } from '@/services/permissions';
import { listProductCategories } from '@/services/products';
import {
  getStockSummary,
  listStockMovements,
  type StockItem,
  type StockMovementWithProduct,
} from '@/services/stock';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { ProductThumb } from '@/features/products/ProductThumb';
import { useTableRevision } from '@/features/products/useTableRevision';
import { AdjustStockSheet } from '@/features/stock/AdjustStockSheet';
import { MovementHistorySheet } from '@/features/stock/MovementHistorySheet';
import {
  AppHeader,
  AppText,
  Badge,
  Card,
  ChipRow,
  EmptyState,
  ListRow,
  Loading,
  Screen,
  SearchBar,
  Segmented,
} from '@/ui';

type StockTab = 'all' | 'low' | 'out' | 'history';
type MoveFilter = 'all' | StockMovement['type'];

const WATCHED_TABLES = ['products', 'stock_movements', 'categories'] as const;

const MOVE_META: Record<
  StockMovement['type'],
  { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }
> = {
  opening: { label: 'Opening', tone: 'neutral' },
  purchase: { label: 'Purchase', tone: 'success' },
  sale: { label: 'Sale', tone: 'danger' },
  adjust: { label: 'Adjust', tone: 'warning' },
  restore: { label: 'Restore', tone: 'neutral' },
};

const MOVE_FILTER_OPTIONS: { value: MoveFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'sale', label: 'Sale' },
  { value: 'adjust', label: 'Adjust' },
  { value: 'opening', label: 'Opening' },
];

export default function StockScreen() {
  const { shopId, userId, role, shop } = useCurrentShop();
  const { colors } = useTheme();
  const { rev, refresh } = useTableRevision(WATCHED_TABLES);

  const [tab, setTab] = useState<StockTab>('all');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [moveFilter, setMoveFilter] = useState<MoveFilter>('all');
  const [adjustTarget, setAdjustTarget] = useState<StockItem | null>(null);
  const [historyTarget, setHistoryTarget] = useState<StockItem | null>(null);

  const canView = can(role, 'viewStock');
  const canViewCost = can(role, 'viewCost');
  const canAdjust = can(role, 'adjustStock');
  const canBuy = can(role, 'buy');
  const decimal = shop?.decimal_enabled === 1;

  const ctx = useMemo(
    () => (shopId && role ? { shopId, userId, role } : null),
    [shopId, userId, role],
  );

  const { categories, summary, movements, error } = useMemo(() => {
    if (!shopId || !canView) {
      return {
        categories: [],
        summary: null,
        movements: [] as StockMovementWithProduct[],
        error: null as string | null,
      };
    }
    void rev;
    try {
      const cats = listProductCategories(db, shopId);
      const sum = getStockSummary(db, shopId, {
        role,
        categoryId: categoryId === 'all' ? null : categoryId,
        search,
        filter: tab === 'low' ? 'low' : tab === 'out' ? 'out' : 'all',
      });
      const movs =
        tab === 'history'
          ? listStockMovements(db, shopId, {
              type: moveFilter === 'all' ? undefined : moveFilter,
              limit: 200,
            })
          : [];
      return { categories: cats, summary: sum, movements: movs, error: null };
    } catch (e) {
      return {
        categories: [],
        summary: null,
        movements: [] as StockMovementWithProduct[],
        error: errorMessage(e),
      };
    }
  }, [shopId, role, canView, rev, categoryId, search, tab, moveFilter]);

  const categoryOptions = useMemo(
    () => [
      { value: 'all', label: 'All' },
      ...categories.map((c) => ({ value: c.id, label: c.name })),
    ],
    [categories],
  );

  const header = (
    <AppHeader
      title="Stock"
      right={[
        ...(canBuy
          ? [{ icon: 'cart-plus' as const, label: 'Buy', onPress: () => router.push('/buy') }]
          : []),
        {
          icon: 'package-variant',
          label: 'Products',
          onPress: () => router.push('/products'),
        },
      ]}
    />
  );

  if (!shopId) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading stock…" />
      </Screen>
    );
  }

  if (!canView) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="No access"
          message="You do not have permission to view stock."
        />
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll={false} padded={false}>
      <View style={styles.top}>
        {summary ? (
          <Card style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.flex}>
                <AppText variant="label" muted>
                  {canViewCost ? 'Stock value (cost)' : 'Stock value (sell)'}
                </AppText>
                <AppText variant="title" style={{ color: colors.accent }}>
                  {formatTaka(
                    canViewCost && summary.totalValue !== null
                      ? summary.totalValue
                      : summary.totalSellValue,
                    decimal,
                  )}
                </AppText>
              </View>
              {canViewCost ? (
                <View style={styles.rightCol}>
                  <AppText variant="label" muted>
                    Sell value
                  </AppText>
                  <AppText bold style={{ color: colors.success }}>
                    {formatTaka(summary.totalSellValue, decimal)}
                  </AppText>
                </View>
              ) : null}
            </View>

            <View style={styles.statGrid}>
              <View style={[styles.statBox, { backgroundColor: colors.surfaceMuted }]}>
                <AppText variant="label" muted>
                  Total units
                </AppText>
                <AppText bold>{summary.totalUnits}</AppText>
              </View>
              <View style={[styles.statBox, { backgroundColor: colors.surfaceMuted }]}>
                <AppText variant="label" muted>
                  Low stock
                </AppText>
                <AppText
                  bold
                  style={{ color: summary.lowStockCount > 0 ? colors.danger : colors.text }}
                >
                  {summary.lowStockCount}
                </AppText>
              </View>
              <View style={[styles.statBox, { backgroundColor: colors.surfaceMuted }]}>
                <AppText variant="label" muted>
                  Out of stock
                </AppText>
                <AppText
                  bold
                  style={{ color: summary.outOfStockCount > 0 ? colors.danger : colors.text }}
                >
                  {summary.outOfStockCount}
                </AppText>
              </View>
            </View>
          </Card>
        ) : null}

        <Segmented<StockTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All' },
            { value: 'low', label: `Low (${summary?.lowStockCount ?? 0})` },
            { value: 'out', label: `Out (${summary?.outOfStockCount ?? 0})` },
            { value: 'history', label: 'History' },
          ]}
        />

        {tab === 'history' ? (
          <ChipRow options={MOVE_FILTER_OPTIONS} value={moveFilter} onChange={setMoveFilter} />
        ) : (
          <>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search stock items" />
            {categories.length > 0 ? (
              <ChipRow options={categoryOptions} value={categoryId} onChange={setCategoryId} />
            ) : null}
          </>
        )}
      </View>

      {error ? (
        <View style={styles.pad}>
          <Card>
            <EmptyState icon="alert-circle-outline" title="Failed to load stock" message={error} />
          </Card>
        </View>
      ) : tab === 'history' ? (
        <FlatList
          data={movements}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="history"
              title="No stock movements"
              message="Purchases, sales, opening stock, and manual adjustments will appear here."
            />
          }
          renderItem={({ item }) => {
            const meta = MOVE_META[item.type];
            const positive = item.qty >= 0;
            return (
              <ListRow
                title={item.productName}
                subtitle={`${formatDateTime(item.date)}${item.note ? ` · ${item.note}` : ''}`}
                left={<Badge label={meta.label} tone={meta.tone} />}
                right={
                  <AppText
                    bold
                    style={{ color: positive ? colors.success : colors.danger }}
                  >
                    {positive ? '+' : ''}
                    {item.qty} {item.productUnit}
                  </AppText>
                }
              />
            );
          }}
        />
      ) : (
        <FlatList
          data={summary?.items ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="warehouse"
              title={
                tab === 'low'
                  ? 'No low-stock items'
                  : tab === 'out'
                    ? 'No out-of-stock items'
                    : 'No products in stock'
              }
              message={
                tab === 'all'
                  ? 'Add products in Product list to track stock levels.'
                  : 'All items are healthy right now.'
              }
            />
          }
          renderItem={({ item }) => {
            const stockTone = item.isOutOfStock
              ? 'danger'
              : item.isLowStock
                ? 'warning'
                : 'success';
            const valueLine =
              canViewCost && item.stockValue !== null
                ? `Value ${formatTaka(item.stockValue, decimal)} · Buy ${formatTaka(item.buy_price, decimal)}`
                : `Sell ${formatTaka(item.sell_price, decimal)}`;

            return (
              <ListRow
                title={item.name}
                subtitle={
                  item.low_stock_alert > 0
                    ? `${valueLine} · Alert ≤ ${item.low_stock_alert}`
                    : valueLine
                }
                left={<ProductThumb uri={item.image_uri} size={44} />}
                right={
                  <View style={styles.itemRight}>
                    <Badge label={`${item.stock} ${item.unit}`} tone={stockTone} />
                    {canAdjust ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Adjust ${item.name}`}
                        onPress={() => setAdjustTarget(item)}
                        style={[styles.adjustBtn, { backgroundColor: colors.primarySoft }]}
                      >
                        <AppText variant="label" bold style={{ color: colors.onPrimary }}>
                          Adjust
                        </AppText>
                      </Pressable>
                    ) : null}
                  </View>
                }
                onPress={() => setHistoryTarget(item)}
              />
            );
          }}
        />
      )}

      <AdjustStockSheet
        target={adjustTarget}
        ctx={ctx}
        onClose={() => setAdjustTarget(null)}
        onDone={refresh}
      />

      <MovementHistorySheet
        target={historyTarget}
        shopId={shopId}
        rev={rev}
        canAdjust={canAdjust}
        onClose={() => setHistoryTarget(null)}
        onAdjust={() => {
          const t = historyTarget;
          setHistoryTarget(null);
          if (t) setAdjustTarget(t);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  summaryCard: { gap: 10 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rightCol: { alignItems: 'flex-end' },
  statGrid: { flexDirection: 'row', gap: 8 },
  statBox: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.row,
    gap: 2,
  },
  pad: { padding: 16 },
  listContent: { flexGrow: 1, paddingBottom: 24 },
  itemRight: { alignItems: 'flex-end', gap: 6 },
  adjustBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});
