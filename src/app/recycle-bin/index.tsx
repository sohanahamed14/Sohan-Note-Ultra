import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { can } from '@/services/permissions';
import {
  deleteForever,
  emptyRecycleBin,
  listDeleted,
  restoreItem,
  type RecycleEntity,
  type RecycleItem,
} from '@/services/recycle';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import {
  AmountText,
  AppHeader,
  AppText,
  Badge,
  Button,
  Card,
  ChipRow,
  ConfirmDialog,
  EmptyState,
  Loading,
  Screen,
  useToast,
  type IconName,
} from '@/ui';

type FilterValue = RecycleEntity | 'all';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sale', label: 'Sales' },
  { value: 'purchase', label: 'Purchases' },
  { value: 'expense', label: 'Expenses' },
  { value: 'product', label: 'Products' },
  { value: 'party', label: 'Contacts' },
  { value: 'cash', label: 'Cash' },
  { value: 'ledger', label: 'Due entries' },
  { value: 'category', label: 'Categories' },
  { value: 'online_order', label: 'Orders' },
];

const ENTITY_META: Record<RecycleEntity, { label: string; icon: IconName }> = {
  sale: { label: 'Sale', icon: 'receipt-text-outline' },
  purchase: { label: 'Purchase', icon: 'cart-arrow-down' },
  expense: { label: 'Expense', icon: 'cash-minus' },
  product: { label: 'Product', icon: 'package-variant-closed' },
  party: { label: 'Contact', icon: 'account-outline' },
  cash: { label: 'Cash', icon: 'cash-register' },
  ledger: { label: 'Due', icon: 'book-account-outline' },
  category: { label: 'Category', icon: 'tag-outline' },
  online_order: { label: 'Order', icon: 'shopping-outline' },
};

export default function RecycleBinScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, role, shop } = useCurrentShop();

  const [filter, setFilter] = useState<FilterValue>('all');
  const [items, setItems] = useState<RecycleItem[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<RecycleItem | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<RecycleItem | null>(null);
  const [emptyConfirm, setEmptyConfirm] = useState(false);

  const canRestore = can(role, 'restore');
  const canDelete = can(role, 'delete');

  const reload = useCallback(() => {
    if (!shopId || !role || !canRestore) return;
    try {
      setItems(listDeleted(db, shopId, role, filter));
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  }, [shopId, role, canRestore, filter, toast]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (!shop || !shopId || !role) {
    return (
      <Screen header={<AppHeader title="Recycle bin" />} scroll={false}>
        <Loading label="Loading recycle bin…" />
      </Screen>
    );
  }

  if (!canRestore) {
    return (
      <Screen header={<AppHeader title="Recycle bin" />} scroll={false}>
        <EmptyState
          icon="shield-lock-outline"
          title="Restricted access"
          message="Only shop owners and managers can view or restore deleted records."
        />
      </Screen>
    );
  }

  const decimal = shop.decimal_enabled === 1;

  const handleRestore = () => {
    if (!restoreTarget) return;
    try {
      restoreItem(db, shopId, role, restoreTarget.entity, restoreTarget.id);
      toast.show(`Restored "${restoreTarget.title}"`, 'success');
      setRestoreTarget(null);
      reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handlePurge = () => {
    if (!purgeTarget) return;
    try {
      deleteForever(db, shopId, role, purgeTarget.entity, purgeTarget.id);
      toast.show('Deleted permanently', 'info');
      setPurgeTarget(null);
      reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleEmptyAll = () => {
    try {
      const count = emptyRecycleBin(db, shopId, role);
      toast.show(`Permanently deleted ${count} items`, 'info');
      setEmptyConfirm(false);
      reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <Screen
      scroll={false}
      header={
        <AppHeader
          title="Recycle bin"
          right={
            canDelete && items.length > 0
              ? [
                  {
                    icon: 'delete-sweep-outline',
                    label: 'Empty recycle bin',
                    onPress: () => setEmptyConfirm(true),
                  },
                ]
              : []
          }
        />
      }
    >
      <View>
        <ChipRow options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => `${item.entity}:${item.id}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="delete-empty-outline"
            title="Recycle bin is empty"
            message="Deleted sales, purchases, expenses, products, and contacts appear here so you can restore them anytime."
          />
        }
        renderItem={({ item }) => {
          const meta = ENTITY_META[item.entity];
          return (
            <Card style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accent + '18' }]}>
                  <MaterialCommunityIcons name={meta.icon} size={22} color={colors.accent} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.topLine}>
                    <AppText bold numberOfLines={1} style={styles.flex}>
                      {item.title}
                    </AppText>
                    {item.amount !== null ? (
                      <AmountText paisa={item.amount} decimal={decimal} variant="secondary" />
                    ) : null}
                  </View>
                  <View style={styles.subLine}>
                    <Badge label={meta.label} />
                    {item.subtitle ? (
                      <AppText variant="label" muted numberOfLines={1} style={styles.flex}>
                        {item.subtitle}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="label" muted>
                    Deleted {formatDateTime(item.deletedAt)}
                  </AppText>
                </View>
              </View>

              <View style={styles.actions}>
                <Button
                  label="Restore"
                  variant="outline"
                  icon="restore"
                  onPress={() => setRestoreTarget(item)}
                  style={styles.flex}
                />
                {canDelete ? (
                  <Button
                    label="Delete forever"
                    variant="danger"
                    icon="delete-forever-outline"
                    onPress={() => setPurgeTarget(item)}
                    style={styles.flex}
                  />
                ) : null}
              </View>
            </Card>
          );
        }}
      />

      <ConfirmDialog
        visible={Boolean(restoreTarget)}
        title="Restore record?"
        message={`Restore "${restoreTarget?.title ?? ''}"? All linked items, stock, cash, and due ledger entries deleted with it will be re-applied.`}
        confirmLabel="Restore"
        onCancel={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
      />

      <ConfirmDialog
        visible={Boolean(purgeTarget)}
        title="Delete forever?"
        message={`Permanently delete "${purgeTarget?.title ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete forever"
        destructive
        onCancel={() => setPurgeTarget(null)}
        onConfirm={handlePurge}
      />

      <ConfirmDialog
        visible={emptyConfirm}
        title="Empty recycle bin?"
        message="All deleted records in the recycle bin will be permanently removed. This cannot be undone."
        confirmLabel="Empty bin"
        destructive
        onCancel={() => setEmptyConfirm(false)}
        onConfirm={handleEmptyAll}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, paddingBottom: 24, flexGrow: 1 },
  card: { padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 },
  actions: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
