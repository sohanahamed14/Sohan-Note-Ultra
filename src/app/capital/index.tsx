import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { cash_entries, type CashEntry } from '@/db/schema';
import { CashEntrySheet } from '@/features/cash/CashEntrySheet';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import {
  deleteCapitalEntry,
  getCapitalSummary,
  listCapitalEntries,
  type CapitalType,
} from '@/services/capital';
import { METHOD_LABELS } from '@/services/cash';
import { can } from '@/services/permissions';
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
} from '@/ui';

type Filter = 'all' | CapitalType;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'capital_in', label: 'Investments' },
  { value: 'capital_out', label: 'Withdrawals' },
];

export default function CapitalScreen() {
  const { colors } = useTheme();
  const { shopId, shop, role, requireShop } = useCurrentShop();
  const toast = useToast();
  const decimal = Boolean(shop?.decimal_enabled);

  const [filter, setFilter] = useState<Filter>('all');
  const [sheetKind, setSheetKind] = useState<'capital_in' | 'capital_out' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashEntry | null>(null);
  const [rev, setRev] = useState(0);

  const canManage = can(role, 'manageCapital');
  const canDelete = can(role, 'delete') && canManage;

  const sid = shopId ?? '';
  const cashLive = useLiveQuery(
    expoDb.select({ id: cash_entries.id }).from(cash_entries).where(active(cash_entries, sid)),
    [sid],
  );

  const loading = !shopId || cashLive.updatedAt === undefined;
  const loadError = cashLive.error;

  const { summary, entries } = useMemo(() => {
    if (!shopId || !canManage) {
      return {
        summary: { totalCapital: 0, totalInvested: 0, totalWithdrawn: 0, count: 0 },
        entries: [] as CashEntry[],
      };
    }
    return {
      summary: getCapitalSummary(db, shopId),
      entries: listCapitalEntries(db, shopId, {
        type: filter === 'all' ? undefined : filter,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, canManage, filter, cashLive.updatedAt, rev]);

  const handleDelete = () => {
    if (!deleteTarget) return;
    try {
      const ctx = requireShop();
      deleteCapitalEntry(db, ctx, deleteTarget.id);
      toast.show('Capital entry moved to recycle bin', 'success');
      setDeleteTarget(null);
      setRev((r) => r + 1);
    } catch (e) {
      setDeleteTarget(null);
      toast.show(errorMessage(e), 'error');
    }
  };

  if (!canManage) {
    return (
      <Screen header={<AppHeader title="Capital" />} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Access restricted"
          message="Only shop owners and managers can manage Capital."
        />
      </Screen>
    );
  }

  const renderItem = ({ item }: { item: CashEntry }) => {
    const isInvest = item.type === 'capital_in';
    return (
      <View
        style={[
          styles.row,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.iconTile,
            { backgroundColor: (isInvest ? colors.success : colors.danger) + '1E' },
          ]}
        >
          <MaterialCommunityIcons
            name={isInvest ? 'bank-plus' : 'bank-minus'}
            size={22}
            color={isInvest ? colors.success : colors.danger}
          />
        </View>

        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <AppText bold>{isInvest ? 'Owner Investment' : 'Owner Withdrawal'}</AppText>
            <Badge label={METHOD_LABELS[item.method]} tone="neutral" />
          </View>
          {item.note ? (
            <AppText variant="secondary" muted numberOfLines={2}>
              {item.note}
            </AppText>
          ) : null}
          <AppText variant="label" muted>
            {formatDateTime(item.date)}
          </AppText>
        </View>

        <AmountText paisa={item.amount} tone="auto" decimal={decimal} />

        {canDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete capital entry"
            hitSlop={8}
            onPress={() => setDeleteTarget(item)}
            style={styles.delBtn}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <Screen header={<AppHeader title="Capital" />} scroll={false} padded={false}>
      {loadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load capital"
          message={loadError.message}
        />
      ) : loading ? (
        <Loading label="Loading capital…" />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.top}>
              <Card style={styles.heroCard}>
                <AppText variant="label" muted>
                  Total Business Capital
                </AppText>
                <AmountText
                  variant="title"
                  paisa={summary.totalCapital}
                  tone="auto"
                  decimal={decimal}
                />

                <View style={styles.statsRow}>
                  <View style={styles.flex}>
                    <AppText variant="label" muted>
                      Total Invested
                    </AppText>
                    <AppText bold style={{ color: colors.success }}>
                      {formatTaka(summary.totalInvested, decimal)}
                    </AppText>
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="label" muted>
                      Total Withdrawn
                    </AppText>
                    <AppText bold style={{ color: colors.danger }}>
                      {formatTaka(summary.totalWithdrawn, decimal)}
                    </AppText>
                  </View>
                </View>

                <View style={styles.actions}>
                  <Button
                    label="Invest"
                    icon="bank-plus"
                    variant="primary"
                    onPress={() => setSheetKind('capital_in')}
                    style={styles.flex}
                  />
                  <Button
                    label="Withdraw"
                    icon="bank-minus"
                    variant="outline"
                    onPress={() => setSheetKind('capital_out')}
                    disabled={summary.totalCapital <= 0}
                    style={styles.flex}
                  />
                </View>
              </Card>

              <ChipRow options={FILTERS} value={filter} onChange={setFilter} />

              <AppText variant="label" muted>
                History ({entries.length})
              </AppText>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="safe"
              title="No capital entries yet"
              message="Record owner capital investments and withdrawals to track total equity and Cashbox balance."
              action={{ label: 'Add Investment', onPress: () => setSheetKind('capital_in') }}
            />
          }
        />
      )}

      {sheetKind ? (
        <CashEntrySheet
          visible={sheetKind !== null}
          kind={sheetKind}
          decimal={decimal}
          availableCapital={summary.totalCapital}
          onClose={() => setSheetKind(null)}
          onSaved={() => setRev((r) => r + 1)}
        />
      ) : null}

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete capital entry?"
        message="This entry will move to the recycle bin and reverse its impact on Total Capital and Cashbox."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { flexGrow: 1, paddingBottom: 32 },
  top: { padding: 16, gap: 12 },
  heroCard: { gap: 12 },
  statsRow: { flexDirection: 'row', gap: 12 },
  actions: { flexDirection: 'row', gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  delBtn: { padding: 4 },
});
