import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { METHODS, online_orders, type Method, type OnlineOrder } from '@/db/schema';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import {
  convertOrderToSale,
  deleteOnlineOrder,
  normalizeBdPhone,
  parseOrderItems,
  updateOnlineOrderStatus,
  type OnlineOrderStatus,
} from '@/services/online';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { scheduleSync, triggerManualSync } from '@/sync';
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
  Divider,
  EmptyState,
  MoneyInput,
  Screen,
  SearchBar,
  useToast,
} from '@/ui';

type StatusFilter = 'all' | OnlineOrderStatus;

const STATUS_TONE: Record<OnlineOrderStatus, 'warning' | 'neutral' | 'success' | 'danger'> = {
  pending: 'warning',
  confirmed: 'neutral',
  delivered: 'success',
  cancelled: 'danger',
};

const METHOD_LABELS: Record<Method, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

export default function OnlineOrdersScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, userId, role, shop } = useCurrentShop();
  const decimal = shop?.decimal_enabled === 1;
  const canManage = can(role, 'manageOnline');
  const canSell = can(role, 'sell');
  const canDelete = can(role, 'delete');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [paidPaisa, setPaidPaisa] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [deleteTarget, setDeleteTarget] = useState<OnlineOrder | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { data: allOrders } = useLiveQuery(
    expoDb
      .select()
      .from(online_orders)
      .where(and(eq(online_orders.shop_id, shopId ?? ''), isNull(online_orders.deleted_at)))
      .orderBy(desc(online_orders.created_at)),
    [shopId],
  );

  const counts = useMemo(() => {
    const c = { all: allOrders.length, pending: 0, confirmed: 0, delivered: 0, cancelled: 0 };
    for (const o of allOrders) {
      c[o.status] += 1;
    }
    return c;
  }, [allOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allOrders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (q) {
        const hay = `${o.order_no} ${o.customer_name} ${o.phone} ${o.address}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allOrders, statusFilter, search]);

  const selected = useMemo(
    () => allOrders.find((o) => o.id === selectedId) ?? null,
    [allOrders, selectedId],
  );

  const selectedItems = useMemo(
    () => (selected ? parseOrderItems(selected.items_json) : []),
    [selected],
  );

  const openDetail = (order: OnlineOrder) => {
    setSelectedId(order.id);
    setConverting(false);
    setPaidPaisa(order.total);
    setMethod('cash');
  };

  const handleSyncOrders = async () => {
    setSyncing(true);
    try {
      const res = await triggerManualSync();
      toast.show(`Synced (${res.pulled} updates pulled)`, 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleStatusChange = (order: OnlineOrder, next: OnlineOrderStatus) => {
    if (!shopId || !role) return;
    try {
      updateOnlineOrderStatus(db, { shopId, role, orderId: order.id, status: next });
      scheduleSync();
      toast.show(`Order marked ${next}`, 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleConvertToSale = (order: OnlineOrder) => {
    if (!shopId || !role) return;
    try {
      const res = convertOrderToSale(db, {
        shopId,
        userId,
        role,
        orderId: order.id,
        paid: paidPaisa ?? 0,
        method,
      });
      setConverting(false);
      scheduleSync();
      toast.show(`Converted to sale ${res.invoiceNo}`, 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleConfirmDelete = () => {
    if (!shopId || !role || !deleteTarget) return;
    try {
      deleteOnlineOrder(db, { shopId, role, orderId: deleteTarget.id });
      setDeleteTarget(null);
      setSelectedId(null);
      scheduleSync();
      toast.show('Order moved to recycle bin', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const callCustomer = (phone: string) => {
    void Linking.openURL(`tel:${normalizeBdPhone(phone)}`);
  };

  const whatsappCustomer = (order: OnlineOrder) => {
    const clean = normalizeBdPhone(order.phone).replace(/\D/g, '');
    const waPhone = clean.startsWith('01') ? `88${clean}` : clean;
    const msg = encodeURIComponent(
      `Hello ${order.customer_name}, regarding your order ${order.order_no} (${formatTaka(order.total, decimal)}) from ${shop?.name ?? 'our shop'}.`,
    );
    void Linking.openURL(`https://wa.me/${waPhone}?text=${msg}`);
  };

  const renderOrder = ({ item }: { item: OnlineOrder }) => {
    const items = parseOrderItems(item.items_json);
    const totalQty = items.reduce((s, i) => s + i.qty, 0);
    return (
      <Pressable onPress={() => openDetail(item)}>
        <Card style={styles.orderCard}>
          <View style={styles.rowBetween}>
            <View style={styles.rowGap}>
              <AppText bold>{item.order_no}</AppText>
              <Badge
                label={item.status.toUpperCase()}
                tone={STATUS_TONE[item.status]}
              />
              {item.sale_id ? <Badge label="Sale linked" tone="success" /> : null}
            </View>
            <AmountText paisa={item.total} decimal={decimal} />
          </View>

          <View style={styles.rowBetween}>
            <AppText variant="secondary" numberOfLines={1} style={styles.flex}>
              {item.customer_name} · {item.phone}
            </AppText>
            <AppText variant="label" muted>
              {totalQty} {totalQty === 1 ? 'item' : 'items'}
            </AppText>
          </View>

          <View style={styles.rowBetween}>
            <AppText variant="label" muted numberOfLines={1} style={styles.flex}>
              {item.area === 'outside' ? 'Outside city' : 'Inside city'} · {item.address}
            </AppText>
            <AppText variant="label" muted>
              {formatDateTime(item.created_at)}
            </AppText>
          </View>
        </Card>
      </Pressable>
    );
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Order list"
          right={[
            {
              icon: syncing ? 'loading' : 'refresh',
              label: 'Sync orders',
              onPress: () => void handleSyncOrders(),
            },
          ]}
        />
      }
      scroll={false}
    >
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search order #, name, phone" />
      <ChipRow
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: 'all', label: `All (${counts.all})` },
          { value: 'pending', label: `Pending (${counts.pending})` },
          { value: 'confirmed', label: `Confirmed (${counts.confirmed})` },
          { value: 'delivered', label: `Delivered (${counts.delivered})` },
          { value: 'cancelled', label: `Cancelled (${counts.cancelled})` },
        ]}
      />

      <FlatList
        data={filtered}
        keyExtractor={(o) => o.id}
        renderItem={renderOrder}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <EmptyState
            icon="clipboard-list-outline"
            title={allOrders.length === 0 ? 'No online orders yet' : 'No matching orders'}
            message={
              allOrders.length === 0
                ? 'Share your online storefront link so customers can place orders.'
                : 'Try another filter or search query.'
            }
            action={
              allOrders.length === 0
                ? { label: 'Sync now', onPress: () => void handleSyncOrders() }
                : undefined
            }
          />
        }
      />

      {/* Order Detail Sheet */}
      <BottomSheet
        visible={selected !== null}
        onClose={() => {
          setSelectedId(null);
          setConverting(false);
        }}
        title={selected ? `Order ${selected.order_no}` : ''}
      >
        {selected ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
            <View style={styles.rowBetween}>
              <View style={styles.rowGap}>
                <Badge
                  label={selected.status.toUpperCase()}
                  tone={STATUS_TONE[selected.status]}
                />
                <Badge
                  label={selected.area === 'outside' ? 'Outside city' : 'Inside city'}
                  tone="neutral"
                />
              </View>
              <AppText variant="label" muted>
                {formatDateTime(selected.created_at)}
              </AppText>
            </View>

            {/* Customer Card */}
            <View style={[styles.infoBox, { backgroundColor: colors.surfaceMuted }]}>
              <AppText bold>{selected.customer_name}</AppText>
              <AppText variant="secondary">{selected.phone}</AppText>
              <AppText variant="secondary" muted>
                {selected.address}
              </AppText>
              {selected.note ? (
                <AppText variant="label" style={{ color: colors.accent }}>
                  Note: {selected.note}
                </AppText>
              ) : null}
              <View style={styles.contactBtns}>
                <Button
                  label="Call"
                  icon="phone-outline"
                  variant="outline"
                  onPress={() => callCustomer(selected.phone)}
                  style={styles.flex}
                />
                <Button
                  label="WhatsApp"
                  icon="whatsapp"
                  variant="outline"
                  onPress={() => whatsappCustomer(selected)}
                  style={styles.flex}
                />
              </View>
            </View>

            {/* Items */}
            <View style={styles.itemsWrap}>
              <AppText variant="secondary" bold>
                Items
              </AppText>
              {selectedItems.map((it, idx) => (
                <View key={`${it.product_id}-${idx}`} style={styles.rowBetween}>
                  <View style={styles.flex}>
                    <AppText numberOfLines={1}>{it.name}</AppText>
                    <AppText variant="label" muted>
                      {it.qty} × {formatTaka(it.unit_price, decimal)}
                    </AppText>
                  </View>
                  <AmountText paisa={it.total} decimal={decimal} variant="secondary" />
                </View>
              ))}
              <Divider />
              <View style={styles.rowBetween}>
                <AppText variant="secondary" muted>
                  Subtotal
                </AppText>
                <AppText variant="secondary">{formatTaka(selected.subtotal, decimal)}</AppText>
              </View>
              <View style={styles.rowBetween}>
                <AppText variant="secondary" muted>
                  Delivery charge
                </AppText>
                <AppText variant="secondary">
                  {selected.delivery_charge === 0
                    ? 'Free'
                    : formatTaka(selected.delivery_charge, decimal)}
                </AppText>
              </View>
              <View style={styles.rowBetween}>
                <AppText bold>Total</AppText>
                <AmountText paisa={selected.total} decimal={decimal} />
              </View>
            </View>

            {/* Status Workflow */}
            {canManage ? (
              <View style={styles.actionsWrap}>
                {selected.status === 'pending' ? (
                  <View style={styles.actionRow}>
                    <Button
                      label="Confirm order"
                      icon="check-circle-outline"
                      onPress={() => handleStatusChange(selected, 'confirmed')}
                      style={styles.flex}
                    />
                    <Button
                      label="Cancel"
                      variant="danger"
                      onPress={() => handleStatusChange(selected, 'cancelled')}
                    />
                  </View>
                ) : null}

                {selected.status === 'confirmed' ? (
                  <View style={styles.actionRow}>
                    <Button
                      label="Mark delivered"
                      icon="truck-check-outline"
                      onPress={() => handleStatusChange(selected, 'delivered')}
                      style={styles.flex}
                    />
                    {!selected.sale_id ? (
                      <Button
                        label="Cancel"
                        variant="outline"
                        onPress={() => handleStatusChange(selected, 'cancelled')}
                      />
                    ) : null}
                  </View>
                ) : null}

                {selected.status === 'cancelled' ? (
                  <Button
                    label="Reopen as pending"
                    variant="outline"
                    icon="restore"
                    onPress={() => handleStatusChange(selected, 'pending')}
                    fullWidth
                  />
                ) : null}

                {/* Convert to Sale / View Invoice */}
                {selected.sale_id ? (
                  <Button
                    label="View Sale Invoice"
                    variant="yellow"
                    icon="receipt-text-outline"
                    fullWidth
                    onPress={() => {
                      const sid = selected.sale_id;
                      setSelectedId(null);
                      if (sid) router.push({ pathname: '/invoice/[id]', params: { id: sid } });
                    }}
                  />
                ) : selected.status !== 'cancelled' && canSell ? (
                  converting ? (
                    <Card style={styles.convertCard}>
                      <AppText bold>Convert to Sale</AppText>
                      <AppText variant="label" muted>
                        Deducts stock, records cash/due, and generates an invoice.
                      </AppText>
                      <MoneyInput
                        label={`Paid amount (Total: ${formatTaka(selected.total, decimal)})`}
                        value={paidPaisa}
                        onChange={setPaidPaisa}
                      />
                      <AppText variant="label" muted>
                        Due: {formatTaka(Math.max(0, selected.total - (paidPaisa ?? 0)), decimal)}
                      </AppText>
                      <ChipRow
                        value={method}
                        onChange={setMethod}
                        options={METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))}
                      />
                      <View style={styles.actionRow}>
                        <Button
                          label="Back"
                          variant="outline"
                          onPress={() => setConverting(false)}
                          style={styles.flex}
                        />
                        <Button
                          label="Confirm sale"
                          icon="check"
                          onPress={() => handleConvertToSale(selected)}
                          style={styles.flex}
                        />
                      </View>
                    </Card>
                  ) : (
                    <Button
                      label="Convert to Sale"
                      variant="yellow"
                      icon="cash-register"
                      fullWidth
                      onPress={() => {
                        setPaidPaisa(selected.total);
                        setConverting(true);
                      }}
                    />
                  )
                ) : null}

                {canDelete && !selected.sale_id ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDeleteTarget(selected)}
                    style={styles.deleteLink}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
                    <AppText variant="secondary" style={{ color: colors.danger }}>
                      Delete order
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete order?"
        message={
          deleteTarget
            ? `Order ${deleteTarget.order_no} will be moved to the Recycle bin.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { gap: 10, paddingBottom: 24 },
  emptyContainer: { flexGrow: 1 },
  orderCard: { gap: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sheetBody: { gap: 12, paddingBottom: 16 },
  infoBox: { borderRadius: radius.card, padding: 12, gap: 4 },
  contactBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  itemsWrap: { gap: 8 },
  actionsWrap: { gap: 10 },
  actionRow: { flexDirection: 'row', gap: 8 },
  convertCard: { gap: 10 },
  deleteLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
});
