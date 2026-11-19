import { MaterialCommunityIcons } from '@expo/vector-icons';
import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { categories, products, stock_movements } from '@/db/schema';
import { formatTaka, mulQty } from '@/lib/money';
import { getCartSummary, useCartStore, type CartItem } from '@/features/sell/cartStore';
import { QuickSellSheet } from '@/features/sell/QuickSellSheet';
import { can } from '@/services/permissions';
import { listSellableProducts, type SellableProduct } from '@/services/sales';
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
  ChipRow,
  Divider,
  EmptyState,
  Loading,
  MoneyInput,
  QtyStepper,
  Screen,
  SearchBar,
  useToast,
} from '@/ui';

export default function SellPosScreen() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { shopId, role, shop } = useCurrentShop();
  const toast = useToast();
  const dec = Boolean(shop?.decimal_enabled);

  const items = useCartStore((s) => s.items);
  const syncShop = useCartStore((s) => s.syncShop);
  const addProduct = useCartStore((s) => s.addProduct);
  const setQty = useCartStore((s) => s.setQty);
  const setUnitPrice = useCartStore((s) => s.setUnitPrice);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clear);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [quickSellOpen, setQuickSellOpen] = useState(false);
  const [editingPriceItem, setEditingPriceItem] = useState<CartItem | null>(null);
  const [draftPrice, setDraftPrice] = useState<number | null>(null);

  useEffect(() => {
    syncShop(shopId);
  }, [shopId, syncShop]);

  const { data: catRows, error: catErr } = useLiveQuery(
    expoDb
      .select()
      .from(categories)
      .where(and(active(categories, shopId ?? ''), eq(categories.kind, 'product'))),
    [shopId],
  );
  const { updatedAt: prodUpdated, error: prodErr } = useLiveQuery(
    expoDb.select({ id: products.id }).from(products).where(active(products, shopId ?? '')),
    [shopId],
  );
  const { updatedAt: stockUpdated, error: stockErr } = useLiveQuery(
    expoDb
      .select({ id: stock_movements.id })
      .from(stock_movements)
      .where(active(stock_movements, shopId ?? '')),
    [shopId],
  );

  const sellable = useMemo(() => {
    if (!shopId) return [];
    void prodUpdated;
    void stockUpdated;
    return listSellableProducts(db, shopId, {
      search,
      categoryId: categoryId === 'all' ? null : categoryId,
    });
  }, [shopId, search, categoryId, prodUpdated, stockUpdated]);

  const cartByProduct = useMemo(() => {
    const map = new Map<string, CartItem>();
    for (const item of items) {
      if (item.productId) map.set(item.productId, item);
    }
    return map;
  }, [items]);

  const summary = useMemo(() => getCartSummary(items), [items]);

  const categoryOptions = useMemo(
    () => [
      { value: 'all', label: 'All' },
      ...catRows.map((c) => ({ value: c.id, label: c.name })),
    ],
    [catRows],
  );

  const numColumns = width >= 680 ? 3 : 2;
  const queryError = catErr ?? prodErr ?? stockErr;

  if (!shopId || !role) {
    return (
      <Screen header={<AppHeader title="Sell" />} scroll={false}>
        <Loading label="Loading shop..." />
      </Screen>
    );
  }

  if (!can(role, 'sell')) {
    return (
      <Screen header={<AppHeader title="Sell" />} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Access restricted"
          message="Your role does not have permission to make sales."
        />
      </Screen>
    );
  }

  const handleAdd = (entry: SellableProduct) => {
    const res = addProduct(entry.product, entry.stock);
    if (!res.ok) {
      toast.show(res.reason, 'error');
    }
  };

  const handleStep = (key: string, nextQty: number, availableStock?: number) => {
    const res = setQty(key, nextQty, availableStock);
    if (!res.ok) {
      toast.show(res.reason, 'error');
    }
  };

  const openPriceEdit = (item: CartItem) => {
    setEditingPriceItem(item);
    setDraftPrice(item.unitPrice);
  };

  const savePriceEdit = () => {
    if (!editingPriceItem || draftPrice === null || draftPrice < 0) return;
    setUnitPrice(editingPriceItem.key, draftPrice);
    setEditingPriceItem(null);
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Sell"
          right={[
            { icon: 'flash', label: 'Quick sell', onPress: () => setQuickSellOpen(true) },
            {
              icon: 'receipt-text-outline',
              label: 'Sales ledger',
              onPress: () => router.push('/sales'),
            },
          ]}
        />
      }
      scroll={false}
      padded={false}
    >
      <View style={styles.topControls}>
        <View style={styles.searchRow}>
          <View style={styles.flex}>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search products..." />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quick sell"
            onPress={() => setQuickSellOpen(true)}
            style={[styles.quickBtn, { backgroundColor: colors.primary }]}
          >
            <MaterialCommunityIcons name="flash" size={20} color={colors.onPrimary} />
            <AppText variant="secondary" bold style={{ color: colors.onPrimary }}>
              Quick
            </AppText>
          </Pressable>
        </View>
        {categoryOptions.length > 1 ? (
          <ChipRow options={categoryOptions} value={categoryId} onChange={setCategoryId} />
        ) : null}
      </View>

      {queryError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load products"
          message={queryError.message}
        />
      ) : (
        <FlatList
          key={`pos-grid-${numColumns}`}
          data={sellable}
          numColumns={numColumns}
          keyExtractor={(item) => item.product.id}
          contentContainerStyle={[
            styles.gridContent,
            items.length > 0 && styles.gridWithBar,
          ]}
          columnWrapperStyle={styles.gridRow}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="package-variant-closed"
              title={search || categoryId !== 'all' ? 'No matching products' : 'No products yet'}
              message={
                search || categoryId !== 'all'
                  ? 'Try another search term or category.'
                  : 'Add products to your inventory or use Quick Sell for an amount-only sale.'
              }
              action={{
                label: search || categoryId !== 'all' ? 'Clear filters' : 'Quick sell',
                onPress: () => {
                  if (search || categoryId !== 'all') {
                    setSearch('');
                    setCategoryId('all');
                  } else {
                    setQuickSellOpen(true);
                  }
                },
              }}
            />
          }
          renderItem={({ item }) => {
            const { product, stock } = item;
            const inCart = cartByProduct.get(product.id);
            const outOfStock = stock <= 0;
            const lowStock = !outOfStock && product.low_stock_alert > 0 && stock <= product.low_stock_alert;
            const stockTone = outOfStock ? 'danger' : lowStock ? 'warning' : 'success';
            const stockLabel = outOfStock ? 'Out of stock' : `${stock} ${product.unit}`;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${product.name}`}
                onPress={() => handleAdd(item)}
                style={[
                  styles.productCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: inCart ? colors.primary : colors.border,
                    borderWidth: inCart ? 2 : 1,
                    opacity: outOfStock ? 0.65 : 1,
                  },
                ]}
              >
                <View style={[styles.thumbWrap, { backgroundColor: colors.surfaceMuted }]}>
                  {product.image_uri ? (
                    <Image
                      source={{ uri: product.image_uri }}
                      style={styles.thumb}
                      contentFit="cover"
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="package-variant-closed"
                      size={32}
                      color={colors.textMuted}
                    />
                  )}
                  {inCart ? (
                    <View style={[styles.qtyBadge, { backgroundColor: colors.accent }]}>
                      <AppText variant="label" bold style={styles.whiteText}>
                        {inCart.qty}
                      </AppText>
                    </View>
                  ) : null}
                </View>

                <View style={styles.cardBody}>
                  <AppText variant="secondary" bold numberOfLines={2} style={styles.prodName}>
                    {product.name}
                  </AppText>
                  <AmountText paisa={product.sell_price} decimal={dec} variant="secondary" />
                  <Badge label={stockLabel} tone={stockTone} />

                  {inCart ? (
                    <View style={styles.miniStepper}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove one ${product.name}`}
                        onPress={() => handleStep(inCart.key, inCart.qty - 1, stock)}
                        style={[styles.miniBtn, { backgroundColor: colors.surfaceMuted }]}
                      >
                        <MaterialCommunityIcons name="minus" size={18} color={colors.text} />
                      </Pressable>
                      <AppText variant="secondary" bold>
                        {inCart.qty}
                      </AppText>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add one more ${product.name}`}
                        onPress={() => handleStep(inCart.key, inCart.qty + 1, stock)}
                        style={[styles.miniBtn, { backgroundColor: colors.primary }]}
                      >
                        <MaterialCommunityIcons name="plus" size={18} color={colors.onPrimary} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {items.length > 0 ? (
        <View
          style={[
            styles.cartBar,
            { backgroundColor: colors.surface, borderTopColor: colors.border },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review cart"
            onPress={() => setCartSheetOpen(true)}
            style={styles.cartSummaryBtn}
          >
            <View style={[styles.cartIconWrap, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="cart-outline" size={22} color={colors.onPrimary} />
            </View>
            <View>
              <AppText variant="label" muted>
                {summary.lineCount} {summary.lineCount === 1 ? 'item' : 'items'} · Qty{' '}
                {summary.totalQty}
              </AppText>
              <AmountText paisa={summary.subtotal} decimal={dec} />
            </View>
          </Pressable>

          <Button
            label="Checkout"
            icon="arrow-right"
            variant="yellow"
            onPress={() => router.push('/sell/checkout')}
          />
        </View>
      ) : null}

      {/* Cart Review Sheet */}
      <BottomSheet
        visible={cartSheetOpen}
        onClose={() => setCartSheetOpen(false)}
        title={`Cart (${summary.lineCount})`}
      >
        <ScrollView contentContainerStyle={styles.sheetList}>
          {items.map((item) => (
            <View key={item.key} style={[styles.cartRow, { borderBottomColor: colors.border }]}>
              <View style={styles.flex}>
                <AppText bold numberOfLines={1}>
                  {item.name}
                </AppText>
                <Pressable onPress={() => openPriceEdit(item)} style={styles.priceEditLink}>
                  <AppText variant="label" style={{ color: colors.accent }}>
                    {formatTaka(item.unitPrice, dec)} / {item.unit}
                  </AppText>
                  <MaterialCommunityIcons name="pencil-outline" size={13} color={colors.accent} />
                </Pressable>
                <AppText variant="label" muted>
                  Line: {formatTaka(mulQty(item.unitPrice, item.qty), dec)}
                </AppText>
              </View>
              <QtyStepper
                value={item.qty}
                min={0}
                onChange={(q) => handleStep(item.key, q)}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
                onPress={() => removeItem(item.key)}
                hitSlop={8}
              >
                <MaterialCommunityIcons name="delete-outline" size={22} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <Divider />
        <View style={styles.sheetFooter}>
          <View style={styles.sheetTotalRow}>
            <AppText bold>Subtotal</AppText>
            <AmountText paisa={summary.subtotal} decimal={dec} />
          </View>
          <View style={styles.sheetActions}>
            <Button
              label="Clear"
              variant="outline"
              onPress={() => {
                clearCart();
                setCartSheetOpen(false);
              }}
            />
            <Button
              label="Proceed to Checkout"
              variant="yellow"
              onPress={() => {
                setCartSheetOpen(false);
                router.push('/sell/checkout');
              }}
              style={styles.flex}
            />
          </View>
        </View>
      </BottomSheet>

      {/* Edit Unit Price Sheet */}
      <BottomSheet
        visible={Boolean(editingPriceItem)}
        onClose={() => setEditingPriceItem(null)}
        title={editingPriceItem ? `Edit Price · ${editingPriceItem.name}` : 'Edit Price'}
      >
        <MoneyInput label="Unit price" value={draftPrice} onChange={setDraftPrice} />
        <View style={styles.sheetActions}>
          <Button
            label="Cancel"
            variant="outline"
            onPress={() => setEditingPriceItem(null)}
            style={styles.flex}
          />
          <Button
            label="Update Price"
            onPress={savePriceEdit}
            disabled={draftPrice === null || draftPrice < 0}
            style={styles.flex}
          />
        </View>
      </BottomSheet>

      <QuickSellSheet
        visible={quickSellOpen}
        onClose={() => setQuickSellOpen(false)}
        onCreated={(saleId) =>
          router.push({ pathname: '/invoice/[id]', params: { id: saleId } })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topControls: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, gap: 6 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  quickBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  gridContent: { padding: 12, gap: 10, flexGrow: 1 },
  gridWithBar: { paddingBottom: 88 },
  gridRow: { gap: 10 },
  productCard: {
    flex: 1,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  thumbWrap: {
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  thumb: { width: '100%', height: '100%' },
  qtyBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whiteText: { color: '#FFFFFF' },
  cardBody: { padding: 10, gap: 5 },
  prodName: { minHeight: 36 },
  miniStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  miniBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cartSummaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  cartIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetList: { gap: 8, maxHeight: 320 },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  priceEditLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sheetFooter: { gap: 10 },
  sheetTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetActions: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
