import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { cash_entries, METHODS, type CashEntry, type Method } from '@/db/schema';
import { CashEntrySheet } from '@/features/cash/CashEntrySheet';
import {
  DATE_PRESET_OPTIONS,
  resolveDateRange,
  type DatePreset,
} from '@/features/cash/dateFilter';
import { formatDate, formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import {
  CASH_TYPE_LABELS,
  deleteManualCash,
  getCashBalance,
  getCashMethodBreakdown,
  listCashEntries,
  METHOD_LABELS,
} from '@/services/cash';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AmountText,
  AppHeader,
  AppText,
  Badge,
  Button,
  Card,
  ChipRow,
  ConfirmDialog,
  DateField,
  EmptyState,
  Loading,
  Screen,
  SectionCard,
  useToast,
} from '@/ui';

type DirFilter = 'all' | 'in' | 'out';

const DIR_OPTIONS: { value: DirFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in', label: 'Cash In' },
  { value: 'out', label: 'Cash Out' },
];

export default function CashboxScreen() {
  const { colors } = useTheme();
  const { shopId, shop, role, requireShop } = useCurrentShop();
  const toast = useToast();
  const decimal = Boolean(shop?.decimal_enabled);

  const [preset, setPreset] = useState<DatePreset>('today');
  const [customFrom, setCustomFrom] = useState<number>(() => Date.now());
  const [customTo, setCustomTo] = useState<number>(() => Date.now());
  const [methodFilter, setMethodFilter] = useState<Method | null>(null);
  const [dirFilter, setDirFilter] = useState<DirFilter>('all');
  const [sheetKind, setSheetKind] = useState<'cash_in' | 'cash_out' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashEntry | null>(null);
  const [rev, setRev] = useState(0);

  const canView = can(role, 'viewCashbox');
  const canManage = can(role, 'manageCash');
  const canDelete = can(role, 'delete') && canManage;

  const sid = shopId ?? '';
  const cashLive = useLiveQuery(
    expoDb.select({ id: cash_entries.id }).from(cash_entries).where(active(cash_entries, sid)),
    [sid],
  );

  const loading = !shopId || cashLive.updatedAt === undefined;
  const loadError = cashLive.error;

  const range = useMemo(
    () => resolveDateRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const { totalBalance, breakdown, list } = useMemo(() => {
    if (!shopId || !canView) {
      return {
        totalBalance: 0,
        breakdown: null,
        list: {
          entries: [] as CashEntry[],
          totalIn: 0,
          totalOut: 0,
          net: 0,
          openingBalance: 0,
          closingBalance: 0,
        },
      };
    }
    return {
      totalBalance: getCashBalance(db, shopId),
      breakdown: getCashMethodBreakdown(db, shopId),
      list: listCashEntries(db, shopId, {
        from: range.from,
        to: range.to,
        method: methodFilter ?? undefined,
        direction: dirFilter === 'all' ? undefined : dirFilter,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, canView, range.from, range.to, methodFilter, dirFilter, cashLive.updatedAt, rev]);

  const handleDelete = () => {
    if (!deleteTarget) return;
    try {
      const ctx = requireShop();
      deleteManualCash(db, ctx, deleteTarget.id);
      toast.show('Cash entry moved to recycle bin', 'success');
      setDeleteTarget(null);
      setRev((r) => r + 1);
    } catch (e) {
      setDeleteTarget(null);
      toast.show(errorMessage(e), 'error');
    }
  };

  if (!canView) {
    return (
      <Screen header={<AppHeader title="Cashbox" />} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Access restricted"
          message="Only shop owners and managers can view the Cashbox."
        />
      </Screen>
    );
  }

  const renderItem = ({ item, index }: { item: CashEntry; index: number }) => {
    const dayLabel = formatDate(item.date);
    const prev = index > 0 ? list.entries[index - 1] : null;
    const showDayHeader = !prev || formatDate(prev.date) !== dayLabel;
    const isIn = item.amount > 0;
    const isManual = item.ref_id === null && (item.type === 'cash_in' || item.type === 'cash_out');

    return (
      <View>
        {showDayHeader ? (
          <View style={[styles.dayHeader, { backgroundColor: colors.surfaceMuted }]}>
            <AppText variant="label" bold muted>
              {dayLabel}
            </AppText>
          </View>
        ) : null}

        <View
          style={[
            styles.entryRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.entryIcon,
              { backgroundColor: (isIn ? colors.success : colors.danger) + '1E' },
            ]}
          >
            <MaterialCommunityIcons
              name={isIn ? 'arrow-bottom-left' : 'arrow-top-right'}
              size={20}
              color={isIn ? colors.success : colors.danger}
            />
          </View>

          <View style={styles.flex}>
            <View style={styles.titleRow}>
              <AppText bold numberOfLines={1}>
                {CASH_TYPE_LABELS[item.type]}
              </AppText>
              <Badge label={METHOD_LABELS[item.method]} tone="neutral" />
            </View>
            {item.note ? (
              <AppText variant="secondary" muted numberOfLines={1}>
                {item.note}
              </AppText>
            ) : null}
            <AppText variant="label" muted>
              {formatDateTime(item.date)}
            </AppText>
          </View>

          <AmountText
            paisa={item.amount}
            tone="auto"
            decimal={decimal}
          />

          {isManual && canDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete cash entry"
              hitSlop={8}
              onPress={() => setDeleteTarget(item)}
              style={styles.delBtn}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <Screen header={<AppHeader title="Cashbox" />} scroll={false} padded={false}>
      {loadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load cashbox"
          message={loadError.message}
        />
      ) : loading ? (
        <Loading label="Loading cashbox…" />
      ) : (
        <FlatList
          data={list.entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.top}>
              <Card style={styles.heroCard}>
                <AppText variant="label" muted>
                  Total Cashbox Balance
                </AppText>
                <AmountText
                  variant="title"
                  paisa={totalBalance}
                  tone="auto"
                  decimal={decimal}
                />

                <View style={styles.periodStats}>
                  <View style={styles.flex}>
                    <AppText variant="label" muted>
                      Period In
                    </AppText>
                    <AppText bold style={{ color: colors.success }}>
                      {formatTaka(list.totalIn, decimal)}
                    </AppText>
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="label" muted>
                      Period Out
                    </AppText>
                    <AppText bold style={{ color: colors.danger }}>
                      {formatTaka(list.totalOut, decimal)}
                    </AppText>
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="label" muted>
                      Net
                    </AppText>
                    <AmountText paisa={list.net} tone="auto" decimal={decimal} />
                  </View>
                </View>

                {canManage ? (
                  <View style={styles.actionRow}>
                    <Button
                      label="Cash In"
                      icon="plus-circle-outline"
                      variant="primary"
                      onPress={() => setSheetKind('cash_in')}
                      style={styles.flex}
                    />
                    <Button
                      label="Cash Out"
                      icon="minus-circle-outline"
                      variant="danger"
                      onPress={() => setSheetKind('cash_out')}
                      style={styles.flex}
                    />
                  </View>
                ) : null}
              </Card>

              {breakdown ? (
                <SectionCard title="By Payment Method (tap to filter)">
                  <View style={styles.methodGrid}>
                    {METHODS.map((m) => {
                      const activeMethod = methodFilter === m;
                      const bal = breakdown[m].balance;
                      return (
                        <Pressable
                          key={m}
                          accessibilityRole="button"
                          onPress={() => setMethodFilter(activeMethod ? null : m)}
                          style={[
                            styles.methodTile,
                            {
                              backgroundColor: activeMethod
                                ? colors.primarySoft
                                : colors.surfaceMuted,
                              borderColor: activeMethod ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          <AppText variant="label" bold={activeMethod} muted={!activeMethod}>
                            {METHOD_LABELS[m]}
                          </AppText>
                          <AmountText
                            variant="secondary"
                            paisa={bal}
                            tone="auto"
                            decimal={decimal}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                </SectionCard>
              ) : null}

              <ChipRow options={DATE_PRESET_OPTIONS} value={preset} onChange={setPreset} />

              {preset === 'custom' ? (
                <View style={styles.actionRow}>
                  <View style={styles.flex}>
                    <DateField label="From" value={customFrom} onChange={setCustomFrom} />
                  </View>
                  <View style={styles.flex}>
                    <DateField label="To" value={customTo} onChange={setCustomTo} />
                  </View>
                </View>
              ) : null}

              <View style={styles.filterLine}>
                <ChipRow options={DIR_OPTIONS} value={dirFilter} onChange={setDirFilter} />
                {methodFilter ? (
                  <Button
                    label={`Clear ${METHOD_LABELS[methodFilter]}`}
                    variant="ghost"
                    onPress={() => setMethodFilter(null)}
                    style={styles.clearBtn}
                  />
                ) : null}
              </View>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="cash-register"
              title="No cash entries in this period"
              message="Sales, purchases, expenses, due collections, and manual entries appear here."
              action={
                canManage
                  ? { label: 'Add Cash In', onPress: () => setSheetKind('cash_in') }
                  : undefined
              }
            />
          }
        />
      )}

      {sheetKind ? (
        <CashEntrySheet
          visible={sheetKind !== null}
          kind={sheetKind}
          decimal={decimal}
          onClose={() => setSheetKind(null)}
          onSaved={() => setRev((r) => r + 1)}
        />
      ) : null}

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete cash entry?"
        message="This manual cash entry will be moved to the recycle bin and the Cashbox balance will update."
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
  periodStats: { flexDirection: 'row', gap: 10 },
  actionRow: { flexDirection: 'row', gap: 12 },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodTile: {
    width: '31%',
    minWidth: 96,
    flexGrow: 1,
    padding: 10,
    borderRadius: radius.row,
    borderWidth: 1,
    gap: 2,
  },
  filterLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clearBtn: { minHeight: 34, paddingHorizontal: 8 },
  dayHeader: { paddingHorizontal: 16, paddingVertical: 6 },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  delBtn: { padding: 4 },
});
