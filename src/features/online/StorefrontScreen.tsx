import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '@/lib/errors';
import { formatTaka, mulQty, roundQty } from '@/lib/money';
import {
  buildOrderWhatsAppUrl,
  fetchPublicShop,
  getOnlineTheme,
  normalizeBdPhone,
  placePublicOrder,
  recordPublicShopVisit,
  type DeliveryArea,
  type OnlineOrderItem,
  type PublicProduct,
  type PublicShopPayload,
} from '@/services/online';
import { useTheme } from '@/theme';
import { MAX_WIDTH, radius } from '@/theme/tokens';
import {
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  ChipRow,
  Divider,
  EmptyState,
  Loading,
  QtyStepper,
  SearchBar,
  Segmented,
  TextField,
  useToast,
} from '@/ui';

type PlacedReceipt = {
  orderNo: string;
  total: number;
  subtotal: number;
  deliveryCharge: number;
  area: DeliveryArea;
  customerName: string;
  phone: string;
  address: string;
  note: string;
  items: OnlineOrderItem[];
};

export function StorefrontScreen({ slug }: { slug: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PublicShopPayload | null>(null);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  // Order form state
  const [area, setArea] = useState<DeliveryArea>('inside');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<PlacedReceipt | null>(null);

  const visitedSlugRef = useRef<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setReloadTick((t) => t + 1);
  };

  useEffect(() => {
    let cancelled = false;
    fetchPublicShop(slug)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        if (data && visitedSlugRef.current !== slug) {
          visitedSlugRef.current = slug;
          void recordPublicShopVisit(slug);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, reloadTick]);

  const shop = payload?.shop ?? null;
  const products = useMemo(() => payload?.products ?? [], [payload]);
  const theme = getOnlineTheme(shop?.online_theme);
  const numColumns = width >= 720 ? 3 : 2;

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) {
      if (p.category_id && p.category_name) {
        map.set(p.category_id, p.category_name);
      }
    }
    return [
      { value: 'all', label: 'All' },
      ...Array.from(map.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [products]);

  const featuredProducts = useMemo(
    () => products.filter((p) => p.featured === 1),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryId !== 'all' && p.category_id !== categoryId) return false;
      if (q) {
        const hay = `${p.name} ${p.description ?? ''} ${p.category_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, categoryId, search]);

  const cartLines = useMemo<OnlineOrderItem[]>(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    const list: OnlineOrderItem[] = [];
    for (const [productId, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const prod = byId.get(productId);
      if (!prod) continue;
      const cleanQty = roundQty(qty);
      list.push({
        product_id: prod.id,
        name: prod.name,
        qty: cleanQty,
        unit_price: prod.sell_price,
        total: mulQty(prod.sell_price, cleanQty),
      });
    }
    return list;
  }, [cart, products]);

  const cartCount = useMemo(
    () => roundQty(cartLines.reduce((s, l) => s + l.qty, 0)),
    [cartLines],
  );
  const subtotal = useMemo(
    () => cartLines.reduce((s, l) => s + l.total, 0),
    [cartLines],
  );
  const deliveryCharge = shop
    ? area === 'outside'
      ? shop.delivery_outside
      : shop.delivery_inside
    : 0;
  const grandTotal = subtotal + deliveryCharge;

  const setQty = (productId: string, nextQty: number) => {
    setCart((prev) => {
      const next = { ...prev };
      const q = roundQty(nextQty);
      if (q <= 0) delete next[productId];
      else next[productId] = q;
      return next;
    });
  };

  const handlePlaceOrder = async () => {
    if (!shop) return;
    if (cartLines.length === 0) {
      toast.show('Your cart is empty', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await placePublicOrder({
        slug: shop.slug,
        customerName,
        phone,
        address,
        area,
        note: note.trim() || null,
        items: cartLines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
      });
      setReceipt({
        orderNo: res.order_no,
        total: res.total,
        subtotal,
        deliveryCharge,
        area,
        customerName: customerName.trim(),
        phone: normalizeBdPhone(phone),
        address: address.trim(),
        note: note.trim(),
        items: cartLines,
      });
      setCart({});
      toast.show(`Order ${res.order_no} placed!`, 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendWhatsApp = () => {
    if (!shop || !receipt) return;
    const url = buildOrderWhatsAppUrl({
      shopPhone: shop.phone,
      shopName: shop.name,
      orderNo: receipt.orderNo,
      customerName: receipt.customerName,
      phone: receipt.phone,
      address: receipt.address,
      area: receipt.area,
      items: receipt.items,
      subtotal: receipt.subtotal,
      deliveryCharge: receipt.deliveryCharge,
      total: receipt.total,
      note: receipt.note || null,
    });
    void Linking.openURL(url);
  };

  const callShop = () => {
    if (!shop?.phone) return;
    void Linking.openURL(`tel:${normalizeBdPhone(shop.phone)}`);
  };

  const whatsappShop = () => {
    if (!shop?.phone) return;
    const clean = normalizeBdPhone(shop.phone).replace(/\D/g, '');
    const waNum = clean.startsWith('01') ? `88${clean}` : clean;
    void Linking.openURL(`https://wa.me/${waNum}`);
  };

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <Loading label="Loading storefront…" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <EmptyState
          icon="cloud-off-outline"
          title="Could not load shop"
          message={error}
          action={{ label: 'Try again', onPress: handleRetry }}
        />
      </View>
    );
  }

  if (!shop) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <EmptyState
          icon="store-off-outline"
          title="Shop unavailable"
          message="This online shop does not exist or is currently turned off."
        />
      </View>
    );
  }

  const renderProductCard = ({ item }: { item: PublicProduct }) => {
    const qty = cart[item.id] ?? 0;
    return (
      <View style={[styles.gridItem, { maxWidth: `${100 / numColumns}%` }]}>
        <Card style={styles.productCard}>
          <View style={styles.imgWrap}>
            {item.image_uri ? (
              <Image source={{ uri: item.image_uri }} style={styles.productImg} />
            ) : (
              <View style={[styles.imgPlaceholder, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="shopping-outline" size={32} color={colors.textMuted} />
              </View>
            )}
            {item.featured === 1 ? (
              <View style={styles.featuredTag}>
                <Badge label="Featured" tone="warning" />
              </View>
            ) : null}
          </View>

          <View style={styles.productInfo}>
            <AppText bold numberOfLines={2}>
              {item.name}
            </AppText>
            {item.description ? (
              <AppText variant="label" muted numberOfLines={2}>
                {item.description}
              </AppText>
            ) : null}
            <View style={styles.priceRow}>
              <AppText bold style={{ color: theme.accent }}>
                {formatTaka(item.sell_price)}
              </AppText>
              {item.unit ? (
                <AppText variant="label" muted>
                  /{item.unit}
                </AppText>
              ) : null}
            </View>
          </View>

          {!item.in_stock ? (
            <View style={[styles.outOfStock, { backgroundColor: colors.surfaceMuted }]}>
              <AppText variant="label" muted bold>
                Out of stock
              </AppText>
            </View>
          ) : qty > 0 ? (
            <View style={styles.stepperWrap}>
              <QtyStepper value={qty} min={0} onChange={(q) => setQty(item.id, q)} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name} to cart`}
              onPress={() => setQty(item.id, 1)}
              style={[styles.addBtn, { backgroundColor: theme.accent }]}
            >
              <MaterialCommunityIcons name="cart-plus" size={18} color="#FFFFFF" />
              <AppText variant="secondary" bold style={{ color: '#FFFFFF' }}>
                Add
              </AppText>
            </Pressable>
          )}
        </Card>
      </View>
    );
  };

  const listHeader = (
    <View style={styles.listHeader}>
      {/* Featured Strip */}
      {featuredProducts.length > 0 && !search && categoryId === 'all' ? (
        <View style={styles.section}>
          <AppText bold>Featured</AppText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuredList}
          >
            {featuredProducts.map((fp) => {
              const qty = cart[fp.id] ?? 0;
              return (
                <Card key={fp.id} style={styles.featuredCard}>
                  {fp.image_uri ? (
                    <Image source={{ uri: fp.image_uri }} style={styles.featuredImg} />
                  ) : (
                    <View style={[styles.featuredImgPlaceholder, { backgroundColor: colors.surfaceMuted }]}>
                      <MaterialCommunityIcons name="star" size={24} color="#D97706" />
                    </View>
                  )}
                  <AppText variant="secondary" bold numberOfLines={1}>
                    {fp.name}
                  </AppText>
                  <AppText variant="secondary" bold style={{ color: theme.accent }}>
                    {formatTaka(fp.sell_price)}
                  </AppText>
                  {fp.in_stock ? (
                    <Pressable
                      onPress={() => setQty(fp.id, qty + 1)}
                      style={[styles.miniAddBtn, { backgroundColor: theme.accent }]}
                    >
                      <AppText variant="label" bold style={{ color: '#FFFFFF' }}>
                        {qty > 0 ? `In cart (${qty}) +` : 'Add to cart'}
                      </AppText>
                    </Pressable>
                  ) : (
                    <AppText variant="label" muted>
                      Out of stock
                    </AppText>
                  )}
                </Card>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <SearchBar value={search} onChangeText={setSearch} placeholder="Search products…" />

      {categories.length > 1 ? (
        <ChipRow value={categoryId} onChange={setCategoryId} options={categories} />
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Themed Storefront Header */}
      <View
        style={[
          styles.shopHeader,
          { backgroundColor: theme.primary, paddingTop: insets.top + 12 },
        ]}
      >
        <View style={styles.headerInner}>
          {shop.logo_uri ? (
            <Image source={{ uri: shop.logo_uri }} style={styles.shopLogo} />
          ) : (
            <View
              style={[
                styles.shopLogoPlaceholder,
                { backgroundColor: 'rgba(255,255,255,0.28)' },
              ]}
            >
              <MaterialCommunityIcons name="storefront" size={28} color={theme.onPrimary} />
            </View>
          )}
          <View style={styles.flex}>
            <AppText variant="title" style={{ color: theme.onPrimary }} numberOfLines={1}>
              {shop.name}
            </AppText>
            {shop.business_type || shop.address ? (
              <AppText
                variant="label"
                style={{ color: theme.onPrimary, opacity: 0.85 }}
                numberOfLines={2}
              >
                {[shop.business_type, shop.address].filter(Boolean).join(' · ')}
              </AppText>
            ) : null}
          </View>
          <View style={styles.headerActions}>
            {shop.phone ? (
              <>
                <Pressable
                  accessibilityLabel="Call shop"
                  onPress={callShop}
                  style={styles.headerIconBtn}
                >
                  <MaterialCommunityIcons name="phone" size={22} color={theme.onPrimary} />
                </Pressable>
                <Pressable
                  accessibilityLabel="WhatsApp shop"
                  onPress={whatsappShop}
                  style={styles.headerIconBtn}
                >
                  <MaterialCommunityIcons name="whatsapp" size={22} color={theme.onPrimary} />
                </Pressable>
              </>
            ) : null}
            {shop.shop_policy ? (
              <Pressable
                accessibilityLabel="Shop policy"
                onPress={() => setPolicyOpen(true)}
                style={styles.headerIconBtn}
              >
                <MaterialCommunityIcons
                  name="information-outline"
                  size={22}
                  color={theme.onPrimary}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Main Centered Container */}
      <View style={styles.body}>
        <FlatList
          key={`cols-${numColumns}`}
          data={filteredProducts}
          numColumns={numColumns}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={listHeader}
          renderItem={renderProductCard}
          contentContainerStyle={[
            styles.gridContent,
            cartLines.length > 0 && { paddingBottom: 96 },
          ]}
          ListEmptyComponent={
            <EmptyState
              icon="shopping-outline"
              title="No products available"
              message={
                products.length === 0
                  ? 'This shop has not published products yet.'
                  : 'Try another search or category.'
              }
            />
          }
        />

        {/* Sticky Cart Bar */}
        {cartLines.length > 0 ? (
          <View
            style={[
              styles.cartBar,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <View style={styles.flex}>
              <AppText variant="label" muted>
                {cartCount} {cartCount === 1 ? 'item' : 'items'} in cart
              </AppText>
              <AppText variant="title" style={{ color: theme.accent }}>
                {formatTaka(subtotal)}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setReceipt(null);
                setCartOpen(true);
              }}
              style={[styles.checkoutBtn, { backgroundColor: theme.accent }]}
            >
              <MaterialCommunityIcons name="cart-check" size={20} color="#FFFFFF" />
              <AppText bold style={{ color: '#FFFFFF' }}>
                Order now
              </AppText>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Cart & Checkout Sheet */}
      <BottomSheet
        visible={cartOpen}
        onClose={() => setCartOpen(false)}
        title={receipt ? 'Order Confirmed!' : 'Checkout'}
      >
        {receipt ? (
          <ScrollView contentContainerStyle={styles.receiptWrap}>
            <MaterialCommunityIcons name="check-circle" size={56} color={colors.success} />
            <AppText variant="title" style={{ color: colors.success }}>
              {receipt.orderNo}
            </AppText>
            <AppText variant="secondary" muted style={styles.centerText}>
              Thank you, {receipt.customerName}! Your order has been submitted to {shop.name}.
            </AppText>
            <Card style={styles.receiptSummary}>
              <View style={styles.rowBetween}>
                <AppText muted>Items subtotal</AppText>
                <AppText>{formatTaka(receipt.subtotal)}</AppText>
              </View>
              <View style={styles.rowBetween}>
                <AppText muted>
                  Delivery ({receipt.area === 'outside' ? 'Outside city' : 'Inside city'})
                </AppText>
                <AppText>
                  {receipt.deliveryCharge === 0 ? 'Free' : formatTaka(receipt.deliveryCharge)}
                </AppText>
              </View>
              <Divider />
              <View style={styles.rowBetween}>
                <AppText bold>Total payable</AppText>
                <AppText bold style={{ color: colors.success }}>
                  {formatTaka(receipt.total)}
                </AppText>
              </View>
            </Card>

            <Button
              label="Send on WhatsApp"
              icon="whatsapp"
              fullWidth
              onPress={handleSendWhatsApp}
              style={{ backgroundColor: '#25D366', borderColor: '#25D366' }}
            />
            <Button
              label="Continue Shopping"
              variant="outline"
              fullWidth
              onPress={() => {
                setReceipt(null);
                setCartOpen(false);
              }}
            />
          </ScrollView>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.checkoutBody}
          >
            {/* Cart Lines */}
            <View style={styles.cartList}>
              {cartLines.map((line) => (
                <View key={line.product_id} style={styles.cartRow}>
                  <View style={styles.flex}>
                    <AppText bold numberOfLines={1}>
                      {line.name}
                    </AppText>
                    <AppText variant="label" muted>
                      {formatTaka(line.unit_price)} × {line.qty} = {formatTaka(line.total)}
                    </AppText>
                  </View>
                  <QtyStepper
                    value={line.qty}
                    min={0}
                    onChange={(q) => setQty(line.product_id, q)}
                  />
                </View>
              ))}
            </View>

            <Divider />

            {/* Delivery Area */}
            <View style={styles.areaBlock}>
              <AppText variant="secondary" bold>
                Delivery area
              </AppText>
              <Segmented
                value={area}
                onChange={setArea}
                options={[
                  {
                    value: 'inside',
                    label: `Inside (${shop.delivery_inside === 0 ? 'Free' : formatTaka(shop.delivery_inside)})`,
                  },
                  {
                    value: 'outside',
                    label: `Outside (${shop.delivery_outside === 0 ? 'Free' : formatTaka(shop.delivery_outside)})`,
                  },
                ]}
              />
            </View>

            {/* Totals */}
            <View style={[styles.totalsBox, { backgroundColor: colors.surfaceMuted }]}>
              <View style={styles.rowBetween}>
                <AppText variant="secondary" muted>
                  Subtotal
                </AppText>
                <AppText variant="secondary">{formatTaka(subtotal)}</AppText>
              </View>
              <View style={styles.rowBetween}>
                <AppText variant="secondary" muted>
                  Delivery charge
                </AppText>
                <AppText variant="secondary">
                  {deliveryCharge === 0 ? 'Free' : formatTaka(deliveryCharge)}
                </AppText>
              </View>
              <View style={styles.rowBetween}>
                <AppText bold>Grand Total</AppText>
                <AppText bold style={{ color: theme.accent }}>
                  {formatTaka(grandTotal)}
                </AppText>
              </View>
            </View>

            {/* Customer Form */}
            <TextField
              label="Your name *"
              value={customerName}
              onChangeText={setCustomerName}
              placeholder="Full name"
            />
            <TextField
              label="Mobile number *"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="01XXXXXXXXX"
            />
            <TextField
              label="Delivery address *"
              value={address}
              onChangeText={setAddress}
              multiline
              placeholder="House, road, area, district"
            />
            <TextField
              label="Order note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="Any delivery instructions"
            />

            <Button
              label={`Place Order · ${formatTaka(grandTotal)}`}
              icon="check-circle-outline"
              loading={submitting}
              disabled={cartLines.length === 0}
              fullWidth
              onPress={() => void handlePlaceOrder()}
            />
          </ScrollView>
        )}
      </BottomSheet>

      {/* Shop Policy Modal */}
      <BottomSheet
        visible={policyOpen}
        onClose={() => setPolicyOpen(false)}
        title="Shop Policy"
      >
        <ScrollView contentContainerStyle={styles.policyBody}>
          <AppText>{shop.shop_policy}</AppText>
          <Button label="Close" variant="outline" fullWidth onPress={() => setPolicyOpen(false)} />
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  shopHeader: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  headerInner: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shopLogo: { width: 48, height: 48, borderRadius: radius.card },
  shopLogoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerIconBtn: { padding: 8 },
  body: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
  },
  listHeader: { gap: 12, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  section: { gap: 8 },
  featuredList: { gap: 10, paddingBottom: 4 },
  featuredCard: { width: 148, gap: 6, padding: 8 },
  featuredImg: { width: '100%', height: 96, borderRadius: radius.row },
  featuredImgPlaceholder: {
    width: '100%',
    height: 96,
    borderRadius: radius.row,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAddBtn: {
    borderRadius: radius.row,
    paddingVertical: 6,
    alignItems: 'center',
  },
  gridContent: { paddingBottom: 24 },
  gridItem: { flex: 1, padding: 6 },
  productCard: { flex: 1, gap: 8, padding: 10, justifyContent: 'space-between' },
  imgWrap: { position: 'relative' },
  productImg: { width: '100%', aspectRatio: 1, borderRadius: radius.row },
  imgPlaceholder: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.row,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredTag: { position: 'absolute', top: 6, left: 6 },
  productInfo: { gap: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  outOfStock: {
    minHeight: 36,
    borderRadius: radius.row,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperWrap: { alignItems: 'center' },
  addBtn: {
    minHeight: 38,
    borderRadius: radius.row,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cartBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  checkoutBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkoutBody: { gap: 12, paddingBottom: 20 },
  cartList: { gap: 10 },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  areaBlock: { gap: 6 },
  totalsBox: { borderRadius: radius.card, padding: 12, gap: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  receiptWrap: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  receiptSummary: { alignSelf: 'stretch', gap: 8 },
  centerText: { textAlign: 'center' },
  policyBody: { gap: 16, paddingBottom: 16 },
});
