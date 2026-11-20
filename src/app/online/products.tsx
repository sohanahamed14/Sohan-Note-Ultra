import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, eq, isNull } from 'drizzle-orm';
import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Switch, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { products, stock_movements } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import {
  listOnlineProducts,
  setProductFeatured,
  setProductOnlineVisibility,
  type OnlineProductRow,
} from '@/services/online';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { scheduleSync } from '@/sync';
import { useTableRevision } from '@/features/products/useTableRevision';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AmountText,
  AppHeader,
  AppText,
  Badge,
  ChipRow,
  EmptyState,
  Screen,
  SearchBar,
  useToast,
} from '@/ui';

type Filter = 'all' | 'online' | 'hidden';
const ONLINE_WATCHED_TABLES = ['products', 'stock_movements'] as const;

export default function OnlineProductsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, role, shop } = useCurrentShop();
  const { rev } = useTableRevision(ONLINE_WATCHED_TABLES);
  const canManage = can(role, 'manageOnline');
  const decimal = shop?.decimal_enabled === 1;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Reactive subscriptions so list updates immediately after local changes or sync pulls.
  const { data: liveProducts } = useLiveQuery(
    expoDb
      .select({ id: products.id, updated_at: products.updated_at })
      .from(products)
      .where(and(eq(products.shop_id, shopId ?? ''), isNull(products.deleted_at))),
    [shopId],
  );
  const { data: liveMovements } = useLiveQuery(
    expoDb
      .select({ id: stock_movements.id })
      .from(stock_movements)
      .where(and(eq(stock_movements.shop_id, shopId ?? ''), isNull(stock_movements.deleted_at))),
    [shopId],
  );

  const items = useMemo(() => {
    if (!shopId) return [];
    void rev;
    return listOnlineProducts(db, shopId, { search, filter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, search, filter, liveProducts, liveMovements, rev]);

  const onlineCount = useMemo(
    () => {
      void rev;
      return shopId ? listOnlineProducts(db, shopId, { filter: 'online' }).length : 0;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shopId, liveProducts, rev],
  );

  const handleToggleVisible = (item: OnlineProductRow, next: boolean) => {
    if (!shopId || !role) return;
    try {
      setProductOnlineVisibility(db, {
        shopId,
        role,
        productId: item.id,
        online_visible: next,
      });
      scheduleSync();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleToggleFeatured = (item: OnlineProductRow) => {
    if (!shopId || !role || !canManage) return;
    try {
      const next = item.featured !== 1;
      setProductFeatured(db, {
        shopId,
        role,
        productId: item.id,
        featured: next,
      });
      scheduleSync();
      toast.show(next ? 'Added to featured products' : 'Removed from featured', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const renderItem = ({ item }: { item: OnlineProductRow }) => {
    const isOnline = item.online_visible === 1;
    const isFeatured = item.featured === 1;
    return (
      <View
        style={[
          styles.row,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {item.image_uri ? (
          <Image source={{ uri: item.image_uri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumbPlaceholder, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="package-variant" size={24} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.flex}>
          <AppText bold numberOfLines={1}>
            {item.name}
          </AppText>
          <View style={styles.metaRow}>
            <AmountText paisa={item.sell_price} decimal={decimal} variant="secondary" />
            <AppText variant="label" muted>
              /{item.unit}
            </AppText>
            <Badge
              label={item.stock > 0 ? `Stock: ${item.stock}` : 'Out of stock'}
              tone={item.stock > 0 ? 'success' : 'danger'}
            />
          </View>
          {item.category_name ? (
            <AppText variant="label" muted numberOfLines={1}>
              {item.category_name}
            </AppText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFeatured ? 'Unfeature product' : 'Feature product'}
          disabled={!canManage}
          onPress={() => handleToggleFeatured(item)}
          hitSlop={8}
          style={[styles.starBtn, !canManage && styles.disabled]}
        >
          <MaterialCommunityIcons
            name={isFeatured ? 'star' : 'star-outline'}
            size={24}
            color={isFeatured ? '#D97706' : colors.textMuted}
          />
        </Pressable>
        <Switch
          accessibilityLabel={`Show ${item.name} online`}
          disabled={!canManage}
          value={isOnline}
          onValueChange={(v) => handleToggleVisible(item, v)}
          trackColor={{ true: colors.success }}
        />
      </View>
    );
  };

  return (
    <Screen header={<AppHeader title="Online products" />} scroll={false}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search products" />
      <View style={styles.filterBar}>
        <ChipRow
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${liveProducts.length})` },
            { value: 'online', label: `Online (${onlineCount})` },
            { value: 'hidden', label: `Hidden (${Math.max(0, liveProducts.length - onlineCount)})` },
          ]}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <EmptyState
            icon="package-variant-closed"
            title={liveProducts.length === 0 ? 'No products yet' : 'No matching products'}
            message={
              liveProducts.length === 0
                ? 'Add products in Product list first, then enable them for your online shop.'
                : 'Try a different search or filter.'
            }
            action={
              liveProducts.length === 0
                ? { label: 'Go to Product list', onPress: () => router.push('/products') }
                : undefined
            }
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  filterBar: { marginTop: -4 },
  listContent: { gap: 8, paddingBottom: 24 },
  emptyContainer: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  thumb: { width: 52, height: 52, borderRadius: radius.row },
  thumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: radius.row,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  starBtn: { padding: 4 },
  disabled: { opacity: 0.4 },
});
