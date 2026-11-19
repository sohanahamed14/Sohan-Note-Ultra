import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { METHODS, type Method, type Party } from '@/db/schema';
import { now } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka, mulQty } from '@/lib/money';
import { useCartStore } from '@/features/sell/cartStore';
import { CustomerPickerSheet } from '@/features/sell/CustomerPickerSheet';
import { formatMethodLabel } from '@/services/invoice';
import { can } from '@/services/permissions';
import { calculateSaleTotals, createSale } from '@/services/sales';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import {
  AmountText,
  AppHeader,
  AppText,
  Button,
  ChipRow,
  DateField,
  Divider,
  EmptyState,
  Loading,
  MoneyInput,
  QtyStepper,
  Screen,
  SectionCard,
  Segmented,
  TextField,
  useToast,
} from '@/ui';

const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: formatMethodLabel(m) }));

export default function CheckoutScreen() {
  const { colors } = useTheme();
  const { shopId, role, shop, requireShop } = useCurrentShop();
  const toast = useToast();
  const dec = Boolean(shop?.decimal_enabled);

  const items = useCartStore((s) => s.items);
  const setQty = useCartStore((s) => s.setQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clear);

  const [party, setParty] = useState<Party | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountPaisa, setDiscountPaisa] = useState<number | null>(null);
  const [discountPctText, setDiscountPctText] = useState('');
  const [vatOverride, setVatOverride] = useState<string | null>(null);

  const [paidEdited, setPaidEdited] = useState(false);
  const [paidOverride, setPaidOverride] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [date, setDate] = useState<number>(() => now());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const vatText = vatOverride ?? (shop && shop.vat_percent > 0 ? String(shop.vat_percent) : '');

  const parsedDiscountPct = useMemo(() => {
    const n = Number(discountPctText);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [discountPctText]);

  const parsedVatPct = useMemo(() => {
    const n = Number(vatText);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [vatText]);

  const totalsState = useMemo(() => {
    if (items.length === 0) {
      return {
        totals: { subtotal: 0, discount: 0, vat: 0, total: 0, lineTotals: [] as number[] },
        error: null as string | null,
      };
    }
    try {
      const discountValue =
        discountType === 'percent' ? parsedDiscountPct : (discountPaisa ?? 0);
      const totals = calculateSaleTotals({
        items: items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice })),
        discountType,
        discountValue,
        vatPercent: parsedVatPct,
      });
      return { totals, error: null as string | null };
    } catch (e) {
      return {
        totals: { subtotal: 0, discount: 0, vat: 0, total: 0, lineTotals: [] as number[] },
        error: errorMessage(e),
      };
    }
  }, [items, discountType, discountPaisa, parsedDiscountPct, parsedVatPct]);

  const { totals, error: calcError } = totalsState;
  const vatError = parsedVatPct > 100 ? 'VAT cannot exceed 100%' : undefined;
  const discountError = !vatError ? (calcError ?? undefined) : undefined;
  const effectivePaid = paidEdited ? (paidOverride ?? 0) : totals.total;
  const due = Math.max(0, totals.total - effectivePaid);
  const overpaid = effectivePaid > totals.total;
  const needsCustomer = due > 0 && !party;

  if (!shopId || !role) {
    return (
      <Screen header={<AppHeader title="Checkout" />} scroll={false}>
        <Loading label="Loading..." />
      </Screen>
    );
  }

  if (!can(role, 'sell')) {
    return (
      <Screen header={<AppHeader title="Checkout" />} scroll={false}>
        <EmptyState icon="lock-outline" title="Access restricted" />
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen header={<AppHeader title="Checkout" />} scroll={false}>
        <EmptyState
          icon="cart-outline"
          title="Your cart is empty"
          message="Add products on the Sell screen before checking out."
          action={{ label: 'Back to Sell', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const handleStep = (key: string, nextQty: number) => {
    const res = setQty(key, nextQty);
    if (!res.ok) toast.show(res.reason, 'error');
  };

  const handleComplete = () => {
    if (calcError) {
      toast.show(calcError, 'error');
      return;
    }
    if (overpaid) {
      toast.show('Paid amount cannot exceed sale total', 'error');
      return;
    }
    if (needsCustomer) {
      toast.show('Select a customer for due sales', 'error');
      return;
    }
    try {
      setSaving(true);
      const ctx = requireShop();
      const discountValue =
        discountType === 'percent' ? parsedDiscountPct : (discountPaisa ?? 0);
      const created = createSale(db, ctx, {
        kind: 'pos',
        partyId: party?.id ?? null,
        date,
        items: items.map((i) => ({
          productId: i.productId,
          name: i.name,
          qty: i.qty,
          unitPrice: i.unitPrice,
          warrantyDays: i.warrantyDays,
        })),
        discountType,
        discountValue,
        vatPercent: parsedVatPct,
        paid: effectivePaid,
        method,
        note: note.trim() || null,
      });
      clearCart();
      toast.show(`Sale saved — ${created.sale.invoice_no}`, 'success');
      router.replace({ pathname: '/invoice/[id]', params: { id: created.sale.id } });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Checkout" />}>
      {/* Items Summary */}
      <SectionCard title={`Items (${items.length})`}>
        <View style={styles.listGap}>
          {items.map((item) => (
            <View key={item.key} style={[styles.itemRow, { borderBottomColor: colors.border }]}>
              <View style={styles.flex}>
                <AppText variant="secondary" bold numberOfLines={1}>
                  {item.name}
                </AppText>
                <AppText variant="label" muted>
                  {formatTaka(item.unitPrice, dec)} × {item.qty} ={' '}
                  {formatTaka(mulQty(item.unitPrice, item.qty), dec)}
                </AppText>
              </View>
              <QtyStepper value={item.qty} min={0} onChange={(q) => handleStep(item.key, q)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
                onPress={() => removeItem(item.key)}
                hitSlop={8}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      </SectionCard>

      {/* Customer */}
      <SectionCard title="Customer">
        <Pressable
          accessibilityRole="button"
          onPress={() => setPickerOpen(true)}
          style={[
            styles.customerBtn,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: needsCustomer ? colors.danger : colors.border,
            },
          ]}
        >
          <MaterialCommunityIcons
            name="account-outline"
            size={22}
            color={needsCustomer ? colors.danger : colors.accent}
          />
          <View style={styles.flex}>
            <AppText bold>{party ? party.name : 'Walk-in Customer'}</AppText>
            <AppText variant="label" muted>
              {party
                ? (party.phone ?? 'Selected customer')
                : needsCustomer
                  ? 'Required to record due amount'
                  : 'Optional — tap to pick or add customer'}
            </AppText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
        </Pressable>
      </SectionCard>

      {/* Discount & VAT */}
      <SectionCard title="Discount & VAT">
        <View style={styles.formGap}>
          <View style={styles.rowBetween}>
            <AppText variant="secondary" muted>
              Discount mode
            </AppText>
            <Segmented
              options={[
                { value: 'amount', label: '৳ Taka' },
                { value: 'percent', label: '% Percent' },
              ]}
              value={discountType}
              onChange={(v) => {
                setDiscountType(v);
                setDiscountPaisa(null);
                setDiscountPctText('');
              }}
            />
          </View>

          {discountType === 'amount' ? (
            <MoneyInput
              label="Discount amount"
              value={discountPaisa}
              onChange={setDiscountPaisa}
              error={discountError}
            />
          ) : (
            <TextField
              label="Discount (%)"
              placeholder="0"
              value={discountPctText}
              onChangeText={(t) => {
                if (/^\d*\.?\d{0,2}$/.test(t)) setDiscountPctText(t);
              }}
              keyboardType="decimal-pad"
              error={discountError}
            />
          )}

          <TextField
            label="VAT (%)"
            placeholder="0"
            value={vatText}
            onChangeText={(t) => {
              if (/^\d*\.?\d{0,2}$/.test(t)) setVatOverride(t);
            }}
            keyboardType="decimal-pad"
            error={vatError}
          />

          <Divider />

          <View style={styles.totalRow}>
            <AppText variant="secondary" muted>
              Subtotal
            </AppText>
            <AppText variant="secondary">{formatTaka(totals.subtotal, dec)}</AppText>
          </View>
          {totals.discount > 0 ? (
            <View style={styles.totalRow}>
              <AppText variant="secondary" muted>
                Discount
              </AppText>
              <AppText variant="secondary" style={{ color: colors.success }}>
                -{formatTaka(totals.discount, dec)}
              </AppText>
            </View>
          ) : null}
          {totals.vat > 0 ? (
            <View style={styles.totalRow}>
              <AppText variant="secondary" muted>
                VAT ({parsedVatPct}%)
              </AppText>
              <AppText variant="secondary">+{formatTaka(totals.vat, dec)}</AppText>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <AppText variant="title">Grand Total</AppText>
            <AmountText paisa={totals.total} decimal={dec} variant="title" />
          </View>
        </View>
      </SectionCard>

      {/* Payment */}
      <SectionCard title="Payment">
        <View style={styles.formGap}>
          <View style={styles.presetRow}>
            <Button
              label="Full Paid"
              variant={!paidEdited || effectivePaid === totals.total ? 'primary' : 'outline'}
              onPress={() => {
                setPaidEdited(false);
                setPaidOverride(totals.total);
              }}
              style={styles.flex}
            />
            <Button
              label="Half"
              variant="outline"
              onPress={() => {
                setPaidEdited(true);
                setPaidOverride(Math.floor(totals.total / 2));
              }}
              style={styles.flex}
            />
            <Button
              label="Full Due"
              variant={paidEdited && effectivePaid === 0 ? 'danger' : 'outline'}
              onPress={() => {
                setPaidEdited(true);
                setPaidOverride(0);
              }}
              style={styles.flex}
            />
          </View>

          <MoneyInput
            label="Paid amount"
            value={paidEdited ? paidOverride : totals.total}
            onChange={(v) => {
              setPaidEdited(true);
              setPaidOverride(v);
            }}
            error={overpaid ? 'Paid amount cannot exceed total' : undefined}
          />

          <View
            style={[
              styles.dueBanner,
              {
                backgroundColor: due > 0 ? colors.danger + '18' : colors.success + '18',
              },
            ]}
          >
            <AppText variant="secondary" bold style={{ color: due > 0 ? colors.danger : colors.success }}>
              {due > 0 ? 'Remaining Due' : 'Status'}
            </AppText>
            <AppText bold style={{ color: due > 0 ? colors.danger : colors.success }}>
              {due > 0 ? formatTaka(due, dec) : 'Fully Paid'}
            </AppText>
          </View>

          <View style={styles.methodWrap}>
            <AppText variant="secondary" muted>
              Payment method
            </AppText>
            <ChipRow options={METHOD_OPTIONS} value={method} onChange={setMethod} />
          </View>

          <DateField label="Sale date" value={date} onChange={setDate} />

          <TextField
            label="Note (optional)"
            placeholder="Delivery info, reference, remarks..."
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>
      </SectionCard>

      <Button
        label={`Complete Sale · ${formatTaka(totals.total, dec)}`}
        variant="yellow"
        icon="check-circle-outline"
        fullWidth
        loading={saving}
        disabled={Boolean(calcError) || overpaid}
        onPress={handleComplete}
      />

      <CustomerPickerSheet
        visible={pickerOpen}
        selectedId={party?.id ?? null}
        onSelect={setParty}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listGap: { gap: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  customerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  formGap: { gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  presetRow: { flexDirection: 'row', gap: 8 },
  dueBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
  },
  methodWrap: { gap: 4 },
  flex: { flex: 1 },
});
