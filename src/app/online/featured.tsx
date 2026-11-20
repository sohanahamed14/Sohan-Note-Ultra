import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, eq, isNull } from 'drizzle-orm';
import { useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, Switch, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { products } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import {
  listOnlineProducts,
  setProductFeatured,
  type OnlineProductRow,
} from '@/services/online';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { scheduleSync } from '@/sync';
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

type Filter = 'featured' | 'all';

export default function FeaturedProductsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, role, shop } = useCurrentShop();
  const canManage = can(role, 'manageOnline');
  const decimal = shop?.decimal_enabled === 1;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('featured');

  const { data: liveProducts } = useLiveQuery(
    expoDb
      .select({ id: products.id, updated_at: products.updated_at })
      .from(products)
      .where(and(eq(products.shop_id, shopId ?? ''), isNull(products.deleted_at))),
    [shopId],
  );

  const items = useMemo(() => {
    if (!shopId) return [];
    return listOnlineProducts(db, shopId, { search, filter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, search, filter, liveProducts]);

  const featuredCount = useMemo(
    () => (shopId ? listOnlineProducts(db, shopId, { filter: 'featured' }).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shopId, liveProducts],
  );

  const handleToggle = (item: OnlineProductRow, next: boolean) => {
    if (!shopId || !role) return;
    try {
      setProductFeatured(db, {
        shopId,
        role,
        productId: item.id,
        featured: next,
      });
      scheduleSync();
      toast.show(
        next ? `${item.name} featured on storefront` : `${item.name} removed from featured`,
        'success',
      );
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const renderItem = ({ item }: { item: OnlineProductRow }) => {
    const isFeatured = item.featured === 1 && item.online_visible === 1;
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
            <MaterialCommunityIcons name="star-outline" size={24} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.flex}>
          <AppText bold numberOfLines={1}>
            {item.name}
          </AppText>
          <View style={styles.metaRow}>
            <AmountText paisa={item.sell_price} decimal={decimal} variant="secondary" />
            {item.online_visible === 1 ? (
              <Badge label="Online" tone="success" />
            ) : (
              <Badge label="Hidden" tone="neutral" />
            )}
          </View>
        </View>
        <Switch
          accessibilityLabel={`Feature ${item.name}`}
          disabled={!canManage}
          value={isFeatured}
          onValueChange={(v) => handleToggle(item, v)}
          trackColor={{ true: '#D97706' }}
        />
      </View>
    );
  };

  return (
    <Screen header={<AppHeader title="Featured products" />} scroll={false}>
      <AppText variant="secondary" muted>
        Featured items are highlighted at the top of your public storefront. Featuring a hidden
        product automatically makes it visible online.
      </AppText>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search products" />
      <ChipRow
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'featured', label: `Featured (${featuredCount})` },
          { value: 'all', label: `All products (${liveProducts.length})` },
        ]}
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <EmptyState
            icon="star-circle-outline"
            title={filter === 'featured' ? 'No featured products yet' : 'No products found'}
            message={
              filter === 'featured'
                ? 'Switch to All products to pick your best sellers.'
                : 'Add products first to feature them online.'
            }
            action={
              filter === 'featured' && liveProducts.length > 0
                ? { label: 'Browse all products', onPress: () => setFilter('all') }
                : liveProducts.length === 0
                  ? { label: 'Add products', onPress: () => router.push('/products') }
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
