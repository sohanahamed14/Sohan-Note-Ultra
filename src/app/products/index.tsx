import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { can } from '@/services/permissions';
import {
  listProductCategories,
  listProductsWithStock,
  type ProductWithStock,
} from '@/services/products';
import { useCurrentShop } from '@/store/useCurrentShop';
import { ProductThumb } from '@/features/products/ProductThumb';
import { useTableRevision } from '@/features/products/useTableRevision';
import {
  AppHeader,
  AppText,
  Badge,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Fab,
  ListRow,
  Loading,
  Screen,
  SearchBar,
} from '@/ui';

const WATCHED_TABLES = ['products', 'stock_movements', 'categories'] as const;

export default function ProductsScreen() {
  const { shopId, role, shop } = useCurrentShop();
  const { rev } = useTableRevision(WATCHED_TABLES);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [lowOnly, setLowOnly] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);

  const canView = can(role, 'viewProducts');
  const canManage = can(role, 'manageProducts');
  const canViewCost = can(role, 'viewCost');
  const decimal = shop?.decimal_enabled === 1;

  const { categories, items, error } = useMemo(() => {
    if (!shopId || !canView) {
      return { categories: [], items: [] as ProductWithStock[], error: null as string | null };
    }
    void rev;
    try {
      const cats = listProductCategories(db, shopId);
      const list = listProductsWithStock(db, shopId, {
        search,
        categoryId: categoryId === 'all' ? null : categoryId,
        lowStockOnly: lowOnly,
        onlineOnly,
      });
      return { categories: cats, items: list, error: null };
    } catch (e) {
      return { categories: [], items: [] as ProductWithStock[], error: errorMessage(e) };
    }
  }, [shopId, canView, rev, search, categoryId, lowOnly, onlineOnly]);

  const categoryOptions = useMemo(
    () => [
      { value: 'all', label: 'All' },
      ...categories.map((c) => ({ value: c.id, label: c.name })),
    ],
    [categories],
  );

  const lowCount = useMemo(() => items.filter((p) => p.isLowStock).length, [items]);

  const header = (
    <AppHeader
      title="Product list"
      right={[
        {
          icon: 'warehouse',
          label: 'Stock',
          onPress: () => router.push('/stock'),
        },
      ]}
    />
  );

  if (!shopId) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading products…" />
      </Screen>
    );
  }

  if (!canView) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="No access"
          message="You do not have permission to view products."
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      scroll={false}
      padded={false}
      overlay={
        canManage ? (
          <Fab label="Add product" onPress={() => router.push('/products/form')} />
        ) : undefined
      }
    >
      <View style={styles.controls}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search product name, code, category"
        />

        {categories.length > 0 ? (
          <ChipRow options={categoryOptions} value={categoryId} onChange={setCategoryId} />
        ) : null}

        <View style={styles.filterRow}>
          <Chip
            label="Low stock"
            selected={lowOnly}
            onPress={() => setLowOnly((v) => !v)}
          />
          <Chip
            label="Online shop"
            selected={onlineOnly}
            onPress={() => setOnlineOnly((v) => !v)}
          />
          <View style={styles.countWrap}>
            <AppText variant="label" muted>
              {items.length} item{items.length === 1 ? '' : 's'}
              {lowCount > 0 ? ` · ${lowCount} low` : ''}
            </AppText>
          </View>
        </View>
      </View>

      {error ? (
        <View style={styles.pad}>
          <Card>
            <EmptyState icon="alert-circle-outline" title="Failed to load products" message={error} />
          </Card>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="package-variant"
              title={search || categoryId !== 'all' || lowOnly || onlineOnly ? 'No matching products' : 'No products yet'}
              message={
                search || categoryId !== 'all' || lowOnly || onlineOnly
                  ? 'Try clearing your search or filters.'
                  : 'Add your first product to track stock and sell faster.'
              }
              action={
                canManage && !search && categoryId === 'all' && !lowOnly && !onlineOnly
                  ? { label: 'Add product', onPress: () => router.push('/products/form') }
                  : undefined
              }
            />
          }
          renderItem={({ item }) => {
            const metaParts: string[] = [];
            if (item.categoryName) metaParts.push(item.categoryName);
            if (item.code) metaParts.push(`#${item.code}`);
            if (canViewCost) {
              metaParts.push(`Buy ${formatTaka(item.buy_price, decimal)}`);
            }
            if (item.warranty_days > 0) {
              metaParts.push(`${item.warranty_days}d warranty`);
            }
            const stockTone =
              item.stock <= 0 ? 'danger' : item.isLowStock ? 'warning' : 'success';

            return (
              <ListRow
                title={item.name}
                subtitle={metaParts.join(' · ') || `Unit: ${item.unit}`}
                left={<ProductThumb uri={item.image_uri} size={48} />}
                right={
                  <View style={styles.rightCol}>
                    <AppText bold>{formatTaka(item.sell_price, decimal)}</AppText>
                    <View style={styles.badges}>
                      <Badge label={`${item.stock} ${item.unit}`} tone={stockTone} />
                      {item.online_visible === 1 ? <Badge label="Online" tone="neutral" /> : null}
                    </View>
                  </View>
                }
                onPress={() =>
                  router.push({ pathname: '/products/form', params: { id: item.id } })
                }
              />
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 },
  filterRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  countWrap: { marginLeft: 'auto' },
  pad: { padding: 16 },
  listContent: { flexGrow: 1, paddingBottom: 88 },
  rightCol: { alignItems: 'flex-end', gap: 4 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
