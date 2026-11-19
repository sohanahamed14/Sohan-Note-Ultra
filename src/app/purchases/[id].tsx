import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Method } from '@/db/schema';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { can } from '@/services/permissions';
import { deletePurchase, getPurchaseDetail } from '@/services/purchases';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { useTableRevision } from '@/features/products/useTableRevision';
import {
  AppHeader,
  AppText,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  EmptyState,
  Loading,
  Screen,
  SectionCard,
  useToast,
} from '@/ui';

const METHOD_LABELS: Record<Method, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

const WATCHED_TABLES = ['purchases', 'purchase_items', 'parties'] as const;

export default function PurchaseDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const purchaseId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;

  const { shopId, userId, role, shop } = useCurrentShop();
  const { colors } = useTheme();
  const { rev } = useTableRevision(WATCHED_TABLES);
  const toast = useToast();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canBuy = can(role, 'buy');
  const canDelete = can(role, 'delete');
  const decimal = shop?.decimal_enabled === 1;

  const { detail, error } = useMemo(() => {
    if (!shopId || !purchaseId || !canBuy) return { detail: null, error: null as string | null };
    void rev;
    try {
      return { detail: getPurchaseDetail(db, shopId, purchaseId), error: null };
    } catch (e) {
      return { detail: null, error: errorMessage(e) };
    }
  }, [shopId, purchaseId, canBuy, rev]);

  const header = <AppHeader title={detail?.purchase.bill_no ?? 'Purchase detail'} />;

  if (!shopId) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading purchase…" />
      </Screen>
    );
  }

  if (!canBuy) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Restricted"
          message="Only owners and managers can view purchase details."
        />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState icon="alert-circle-outline" title="Failed to load purchase" message={error} />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="receipt-text-remove-outline"
          title="Purchase not found"
          message="This bill may have been deleted."
          action={{ label: 'Back to ledger', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const { purchase, items, supplier } = detail;
  const statusBadge =
    purchase.due === 0
      ? { label: 'Paid', tone: 'success' as const }
      : purchase.paid > 0
        ? { label: 'Partial', tone: 'warning' as const }
        : { label: 'Due', tone: 'danger' as const };

  const handleDelete = () => {
    if (!shopId || !role) return;
    setDeleting(true);
    try {
      deletePurchase(db, { shopId, userId, role }, purchase.id);
      setConfirmOpen(false);
      toast.show('Purchase moved to Recycle Bin and reversed', 'success');
      router.back();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Screen header={header}>
      <Card style={styles.metaCard}>
        <View style={styles.rowBetween}>
          <AppText variant="title">{purchase.bill_no}</AppText>
          <Badge label={statusBadge.label} tone={statusBadge.tone} />
        </View>
        <AppText variant="secondary" muted>
          {formatDateTime(purchase.date)}
        </AppText>
        <Divider />
        <View style={styles.rowBetween}>
          <AppText muted>Supplier</AppText>
          <AppText bold>{supplier ? supplier.name : 'Walk-in Supplier'}</AppText>
        </View>
        {supplier?.phone ? (
          <View style={styles.rowBetween}>
            <AppText muted>Phone</AppText>
            <AppText>{supplier.phone}</AppText>
          </View>
        ) : null}
        <View style={styles.rowBetween}>
          <AppText muted>Payment method</AppText>
          <AppText bold>{METHOD_LABELS[purchase.method]}</AppText>
        </View>
        {purchase.note ? (
          <View style={styles.noteBox}>
            <AppText variant="label" muted>
              Note
            </AppText>
            <AppText variant="secondary">{purchase.note}</AppText>
          </View>
        ) : null}
      </Card>

      <SectionCard title={`Items (${items.length})`}>
        {items.map((item, idx) => (
          <View key={item.id}>
            {idx > 0 ? <Divider /> : null}
            <View style={styles.itemRow}>
              <View style={styles.flex}>
                <AppText bold>{item.name}</AppText>
                <AppText variant="label" muted>
                  {item.qty} × {formatTaka(item.unit_price, decimal)}
                </AppText>
              </View>
              <AppText bold>{formatTaka(item.total, decimal)}</AppText>
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Payment breakdown">
        <View style={styles.totalsCol}>
          <View style={styles.rowBetween}>
            <AppText muted>Subtotal</AppText>
            <AppText>{formatTaka(purchase.subtotal, decimal)}</AppText>
          </View>
          {purchase.discount > 0 ? (
            <View style={styles.rowBetween}>
              <AppText muted>Discount</AppText>
              <AppText>- {formatTaka(purchase.discount, decimal)}</AppText>
            </View>
          ) : null}
          {purchase.vat > 0 ? (
            <View style={styles.rowBetween}>
              <AppText muted>VAT / Tax</AppText>
              <AppText>+ {formatTaka(purchase.vat, decimal)}</AppText>
            </View>
          ) : null}
          <Divider />
          <View style={styles.rowBetween}>
            <AppText variant="title">Total</AppText>
            <AppText variant="title" style={{ color: colors.accent }}>
              {formatTaka(purchase.total, decimal)}
            </AppText>
          </View>
          <View style={styles.rowBetween}>
            <AppText muted>Paid</AppText>
            <AppText bold style={{ color: colors.success }}>
              {formatTaka(purchase.paid, decimal)}
            </AppText>
          </View>
          <View style={styles.rowBetween}>
            <AppText muted>Due</AppText>
            <AppText
              bold
              style={{ color: purchase.due > 0 ? colors.danger : colors.textMuted }}
            >
              {formatTaka(purchase.due, decimal)}
            </AppText>
          </View>
        </View>
      </SectionCard>

      {canDelete ? (
        <View style={styles.deleteWrap}>
          <Button
            label="Delete purchase"
            variant="danger"
            icon="trash-can-outline"
            fullWidth
            onPress={() => setConfirmOpen(true)}
          />
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirmOpen}
        title="Delete purchase?"
        message="This moves the bill to Recycle Bin and reverses added stock, cash out, and supplier due."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  metaCard: { gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  noteBox: { gap: 2, paddingTop: 4 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: 12,
  },
  totalsCol: { gap: 8 },
  deleteWrap: { paddingBottom: 24 },
});
