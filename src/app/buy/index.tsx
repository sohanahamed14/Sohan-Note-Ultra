import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { METHODS, type Method, type Party } from '@/db/schema';
import { now } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { add, formatTaka, mulQty, percentOf, roundQty } from '@/lib/money';
import { can } from '@/services/permissions';
import type { ProductWithStock } from '@/services/products';
import { createPurchase } from '@/services/purchases';
import { useCurrentShop } from '@/store/useCurrentShop';
import { scheduleSync } from '@/sync';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { ProductPickerSheet, type CustomBuyItem } from '@/features/buy/ProductPickerSheet';
import { SupplierPickerSheet } from '@/features/buy/SupplierPickerSheet';
import { useTableRevision } from '@/features/products/useTableRevision';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  ChipRow,
  ConfirmDialog,
  DateField,
  Divider,
  EmptyState,
  Loading,
  MoneyInput,
  QtyStepper,
  Screen,
  SectionCard,
  Segmented,
  SettingsRow,
  TextField,
  useToast,
} from '@/ui';

type CartItem = {
  key: string;
  productId: string | null;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  sellPrice?: number;
};

type PayMode = 'full' | 'partial' | 'due';
type RateKind = 'amount' | 'percent';

const METHOD_LABELS: Record<Method, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }));
const WATCHED_TABLES = ['products', 'stock_movements', 'parties', 'categories'] as const;

export default function BuyScreen() {
  const { shopId, userId, role, shop } = useCurrentShop();
  const { colors } = useTheme();
  const { rev } = useTableRevision(WATCHED_TABLES);
  const toast = useToast();

  const canBuy = can(role, 'buy');
  const decimal = shop?.decimal_enabled === 1;

  const ctx = useMemo(
    () => (shopId && role ? { shopId, userId, role } : null),
    [shopId, userId, role],
  );

  const [supplier, setSupplier] = useState<Party | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [updateBuyPrice, setUpdateBuyPrice] = useState(false);

  const [discountKind, setDiscountKind] = useState<RateKind>('amount');
  const [discountPaisaInput, setDiscountPaisaInput] = useState<number | null>(null);
  const [discountPctText, setDiscountPctText] = useState('');

  const [vatKind, setVatKind] = useState<RateKind>('amount');
  const [vatPaisaInput, setVatPaisaInput] = useState<number | null>(null);
  const [vatPctText, setVatPctText] = useState('');

  const [payMode, setPayMode] = useState<PayMode>('full');
  const [partialPaid, setPartialPaid] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [date, setDate] = useState(() => now());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedPurchase, setSavedPurchase] = useState<{ id: string; billNo: string } | null>(null);

  const cartQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cart) {
      if (c.productId) map.set(c.productId, roundQty((map.get(c.productId) ?? 0) + c.qty));
    }
    return map;
  }, [cart]);

  const subtotal = useMemo(
    () => add(...cart.map((item) => mulQty(item.unitPrice, item.qty))),
    [cart],
  );

  const discountPaisa = useMemo(() => {
    if (discountKind === 'amount') return discountPaisaInput ?? 0;
    const pct = Number(discountPctText || '0');
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    return percentOf(subtotal, Math.min(100, pct));
  }, [discountKind, discountPaisaInput, discountPctText, subtotal]);

  const afterDiscount = Math.max(0, add(subtotal, -discountPaisa));

  const vatPaisa = useMemo(() => {
    if (vatKind === 'amount') return vatPaisaInput ?? 0;
    const pct = Number(vatPctText || '0');
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    return percentOf(afterDiscount, pct);
  }, [vatKind, vatPaisaInput, vatPctText, afterDiscount]);

  const total = add(afterDiscount, vatPaisa);
  const paidPaisa = payMode === 'full' ? total : payMode === 'due' ? 0 : (partialPaid ?? 0);
  const overpaid = paidPaisa > total;
  const duePaisa = overpaid ? 0 : add(total, -paidPaisa);
  const discountTooHigh = discountPaisa > subtotal;
  const needsSupplierForDue = duePaisa > 0 && !supplier;
  const hasCatalogProduct = cart.some((c) => c.productId !== null);

  const header = (
    <AppHeader
      title="Buy (Purchase)"
      right={[
        {
          icon: 'receipt-text-outline',
          label: 'Purchase ledger',
          onPress: () => router.push('/purchases'),
        },
      ]}
    />
  );

  if (!shopId) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading…" />
      </Screen>
    );
  }

  if (!canBuy) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Restricted"
          message="Only owners and managers can record purchases."
        />
      </Screen>
    );
  }

  const handlePickProduct = (product: ProductWithStock) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.productId === product.id);
      if (idx >= 0) {
        return prev.map((c, i) => (i === idx ? { ...c, qty: roundQty(c.qty + 1) } : c));
      }
      return [
        ...prev,
        {
          key: `prod-${product.id}`,
          productId: product.id,
          name: product.name,
          unit: product.unit,
          qty: 1,
          unitPrice: product.buy_price,
        },
      ];
    });
  };

  const handleAddCustomItem = (item: CustomBuyItem) => {
    setCart((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}-${prev.length}`,
        productId: null,
        name: item.name,
        unit: item.unit,
        qty: roundQty(item.qty),
        unitPrice: item.unitPrice,
        sellPrice: item.sellPrice,
      },
    ]);
  };

  const resetForm = () => {
    setSupplier(null);
    setCart([]);
    setDiscountPaisaInput(null);
    setDiscountPctText('');
    setVatPaisaInput(null);
    setVatPctText('');
    setPayMode('full');
    setPartialPaid(null);
    setMethod('cash');
    setDate(now());
    setNote('');
  };

  const handleSubmit = () => {
    if (!ctx) return;
    setSaving(true);
    try {
      const detail = createPurchase(db, ctx, {
        party_id: supplier?.id ?? null,
        items: cart.map((c) => ({
          product_id: c.productId,
          name: c.name,
          unit: c.unit,
          qty: c.qty,
          unit_price: c.unitPrice,
          sell_price: c.sellPrice,
        })),
        discount: discountPaisa,
        vat: vatPaisa,
        paid: paidPaisa,
        method,
        date,
        note: note || null,
        update_buy_price: updateBuyPrice,
      });
      scheduleSync(1500);
      toast.show(`Saved ${detail.purchase.bill_no}`, 'success');
      resetForm();
      setSavedPurchase({ id: detail.purchase.id, billNo: detail.purchase.bill_no });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    cart.length > 0 && !overpaid && !discountTooHigh && !needsSupplierForDue && !saving;

  return (
    <Screen header={header}>
      <SectionCard title="Supplier">
        <Pressable
          accessibilityRole="button"
          onPress={() => setSupplierOpen(true)}
          style={[styles.supplierBtn, { backgroundColor: colors.surfaceMuted }]}
        >
          <MaterialCommunityIcons
            name={supplier ? 'truck' : 'storefront-outline'}
            size={24}
            color={supplier ? colors.accent : colors.textMuted}
          />
          <View style={styles.flex}>
            <AppText bold>{supplier ? supplier.name : 'Walk-in / Cash Supplier'}</AppText>
            <AppText variant="label" muted>
              {supplier
                ? supplier.phone ?? 'Tap to change supplier'
                : 'Tap to select or add a supplier'}
            </AppText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
        </Pressable>
      </SectionCard>

      <SectionCard title={`Items (${cart.length})`}>
        <View style={styles.colGap}>
          {cart.length === 0 ? (
            <View style={styles.emptyCart}>
              <AppText variant="secondary" muted>
                No items added yet. Pick products from your catalog or add a custom item.
              </AppText>
              <Button
                label="Add products"
                variant="yellow"
                icon="plus"
                fullWidth
                onPress={() => setPickerOpen(true)}
              />
            </View>
          ) : (
            <>
              {cart.map((item, idx) => {
                const lineTotal = mulQty(item.unitPrice, item.qty);
                return (
                  <View key={item.key}>
                    {idx > 0 ? <Divider /> : null}
                    <View style={styles.cartItem}>
                      <View style={styles.cartHeader}>
                        <AppText bold style={styles.flex} numberOfLines={1}>
                          {item.name}
                        </AppText>
                        <AppText bold>{formatTaka(lineTotal, decimal)}</AppText>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${item.name}`}
                          hitSlop={8}
                          onPress={() =>
                            setCart((prev) => prev.filter((c) => c.key !== item.key))
                          }
                        >
                          <MaterialCommunityIcons
                            name="close-circle-outline"
                            size={20}
                            color={colors.danger}
                          />
                        </Pressable>
                      </View>

                      <View style={styles.cartControls}>
                        <View style={styles.flex}>
                          <MoneyInput
                            label={`Buy price / ${item.unit}`}
                            value={item.unitPrice}
                            onChange={(p) =>
                              setCart((prev) =>
                                prev.map((c) =>
                                  c.key === item.key ? { ...c, unitPrice: p ?? 0 } : c,
                                ),
                              )
                            }
                          />
                        </View>
                        <View style={styles.qtyCol}>
                          <AppText variant="label" muted>
                            Qty ({item.unit})
                          </AppText>
                          <QtyStepper
                            value={item.qty}
                            min={0.001}
                            step={1}
                            onChange={(q) =>
                              setCart((prev) =>
                                prev.map((c) => (c.key === item.key ? { ...c, qty: q } : c)),
                              )
                            }
                          />
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}

              <Button
                label="Add more products"
                variant="outline"
                icon="plus"
                fullWidth
                onPress={() => setPickerOpen(true)}
              />

              {hasCatalogProduct ? (
                <SettingsRow
                  icon="tag-outline"
                  label="Update product default buy price"
                  kind="switch"
                  value={updateBuyPrice}
                  onValueChange={setUpdateBuyPrice}
                />
              ) : null}
            </>
          )}
        </View>
      </SectionCard>

      <SectionCard title="Totals & payment">
        <View style={styles.colGap}>
          <View style={styles.totalRow}>
            <AppText muted>Subtotal</AppText>
            <AppText bold>{formatTaka(subtotal, decimal)}</AppText>
          </View>

          <View style={styles.rateBlock}>
            <View style={styles.rateHeader}>
              <AppText variant="secondary" muted>
                Discount
              </AppText>
              <Segmented<RateKind>
                value={discountKind}
                onChange={setDiscountKind}
                options={[
                  { value: 'amount', label: '৳' },
                  { value: 'percent', label: '%' },
                ]}
              />
            </View>
            {discountKind === 'amount' ? (
              <MoneyInput
                value={discountPaisaInput}
                onChange={setDiscountPaisaInput}
                placeholder="0"
                error={discountTooHigh ? 'Discount cannot exceed subtotal' : undefined}
              />
            ) : (
              <TextField
                value={discountPctText}
                onChangeText={(t) => {
                  if (/^\d*\.?\d{0,2}$/.test(t)) setDiscountPctText(t);
                }}
                keyboardType="decimal-pad"
                placeholder="0 %"
                helper={
                  discountPaisa > 0 ? `Discount: ${formatTaka(discountPaisa, decimal)}` : undefined
                }
              />
            )}
          </View>

          <View style={styles.rateBlock}>
            <View style={styles.rateHeader}>
              <AppText variant="secondary" muted>
                VAT / Tax
              </AppText>
              <Segmented<RateKind>
                value={vatKind}
                onChange={setVatKind}
                options={[
                  { value: 'amount', label: '৳' },
                  { value: 'percent', label: '%' },
                ]}
              />
            </View>
            {vatKind === 'amount' ? (
              <MoneyInput value={vatPaisaInput} onChange={setVatPaisaInput} placeholder="0" />
            ) : (
              <TextField
                value={vatPctText}
                onChangeText={(t) => {
                  if (/^\d*\.?\d{0,2}$/.test(t)) setVatPctText(t);
                }}
                keyboardType="decimal-pad"
                placeholder="0 %"
                helper={vatPaisa > 0 ? `VAT: ${formatTaka(vatPaisa, decimal)}` : undefined}
              />
            )}
          </View>

          <Divider />

          <View style={styles.totalRow}>
            <AppText variant="title">Total</AppText>
            <AppText variant="title" style={{ color: colors.accent }}>
              {formatTaka(total, decimal)}
            </AppText>
          </View>

          <Segmented<PayMode>
            value={payMode}
            onChange={(m) => {
              setPayMode(m);
              if (m === 'partial' && partialPaid === null) setPartialPaid(0);
            }}
            options={[
              { value: 'full', label: 'Full Paid' },
              { value: 'partial', label: 'Partial' },
              { value: 'due', label: 'Full Due' },
            ]}
          />

          {payMode === 'partial' ? (
            <MoneyInput
              label="Paid amount"
              value={partialPaid}
              onChange={setPartialPaid}
              placeholder="0"
              error={overpaid ? 'Paid amount cannot exceed total' : undefined}
            />
          ) : null}

          <Card style={[styles.dueCard, { backgroundColor: colors.surfaceMuted }]}>
            <View style={styles.totalRow}>
              <AppText variant="secondary" muted>
                Paid now
              </AppText>
              <AppText bold style={{ color: colors.success }}>
                {formatTaka(paidPaisa, decimal)}
              </AppText>
            </View>
            <View style={styles.totalRow}>
              <AppText variant="secondary" muted>
                Due to supplier
              </AppText>
              <AppText bold style={{ color: duePaisa > 0 ? colors.danger : colors.textMuted }}>
                {formatTaka(duePaisa, decimal)}
              </AppText>
            </View>
            {needsSupplierForDue ? (
              <AppText variant="label" style={{ color: colors.danger }}>
                Select a supplier above to record a due purchase.
              </AppText>
            ) : null}
          </Card>

          <View style={styles.methodWrap}>
            <AppText variant="secondary" muted>
              Payment method
            </AppText>
            <ChipRow options={METHOD_OPTIONS} value={method} onChange={setMethod} />
          </View>

          <DateField label="Purchase date" value={date} onChange={setDate} />

          <TextField
            label="Note (optional)"
            placeholder="Supplier bill ref or remark"
            value={note}
            onChangeText={setNote}
          />
        </View>
      </SectionCard>

      <View style={styles.submitWrap}>
        <Button
          label={
            cart.length > 0
              ? `Save Purchase · ${formatTaka(total, decimal)}`
              : 'Save Purchase'
          }
          variant="primary"
          icon="check"
          fullWidth
          loading={saving}
          disabled={!canSave}
          onPress={handleSubmit}
        />
      </View>

      <SupplierPickerSheet
        visible={supplierOpen}
        shopId={shopId}
        ctx={ctx}
        selectedId={supplier?.id ?? null}
        rev={rev}
        onClose={() => setSupplierOpen(false)}
        onSelect={setSupplier}
      />

      <ProductPickerSheet
        visible={pickerOpen}
        shopId={shopId}
        decimal={decimal}
        rev={rev}
        cartQtyByProductId={cartQtyByProductId}
        onClose={() => setPickerOpen(false)}
        onPickProduct={handlePickProduct}
        onAddCustomItem={handleAddCustomItem}
      />

      <ConfirmDialog
        visible={!!savedPurchase}
        title="Purchase recorded"
        message={
          savedPurchase
            ? `${savedPurchase.billNo} saved. Stock, cashbox, and supplier ledger updated.`
            : undefined
        }
        confirmLabel="View bill"
        cancelLabel="New buy"
        onConfirm={() => {
          const id = savedPurchase?.id;
          setSavedPurchase(null);
          if (id) router.push({ pathname: '/purchases/[id]', params: { id } });
        }}
        onCancel={() => setSavedPurchase(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  colGap: { gap: 12 },
  supplierBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.row,
  },
  emptyCart: { gap: 10, paddingVertical: 6 },
  cartItem: { gap: 8, paddingVertical: 8 },
  cartHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cartControls: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  qtyCol: { gap: 4, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rateBlock: { gap: 6 },
  rateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dueCard: { gap: 6 },
  methodWrap: { gap: 4 },
  submitWrap: { paddingBottom: 24 },
});
