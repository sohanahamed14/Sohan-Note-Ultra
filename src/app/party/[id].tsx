import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { cash_entries, parties, party_ledger } from '@/db/schema';
import {
  DATE_PRESET_OPTIONS,
  resolveDateRange,
  type DatePreset,
} from '@/features/cash/dateFilter';
import { PartyFormSheet } from '@/features/contacts/PartyFormSheet';
import { LedgerEntrySheet } from '@/features/due/LedgerEntrySheet';
import {
  callPartyPhone,
  openSmsStatement,
  openWhatsAppStatement,
  shareStatementPdf,
} from '@/features/due/statementActions';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { METHOD_LABELS } from '@/services/cash';
import {
  deleteLedgerEntry,
  LEDGER_TYPE_LABELS,
  listPartyLedger,
  type LedgerEntryWithBalance,
} from '@/services/ledger';
import { getPartyById } from '@/services/parties';
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
  useToast,
  type IconName,
} from '@/ui';

function QuickAction({
  icon,
  label,
  color,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.quickBtn,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={color} />
      <AppText variant="label" bold numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const partyId = Array.isArray(id) ? (id[0] ?? '') : (id ?? '');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { shopId, shop, role, requireShop } = useCurrentShop();
  const toast = useToast();
  const decimal = Boolean(shop?.decimal_enabled);

  const [preset, setPreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState<number>(() => Date.now());
  const [customTo, setCustomTo] = useState<number>(() => Date.now());
  const [entrySheet, setEntrySheet] = useState<'give' | 'take' | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LedgerEntryWithBalance | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [rev, setRev] = useState(0);

  const sid = shopId ?? '';
  const partiesLive = useLiveQuery(
    expoDb.select({ id: parties.id }).from(parties).where(active(parties, sid)),
    [sid],
  );
  const ledgerLive = useLiveQuery(
    expoDb.select({ id: party_ledger.id }).from(party_ledger).where(active(party_ledger, sid)),
    [sid],
  );
  const cashLive = useLiveQuery(
    expoDb.select({ id: cash_entries.id }).from(cash_entries).where(active(cash_entries, sid)),
    [sid],
  );

  const loading = !shopId || partiesLive.updatedAt === undefined || ledgerLive.updatedAt === undefined;
  const loadError = partiesLive.error ?? ledgerLive.error ?? cashLive.error;

  const range = useMemo(
    () => resolveDateRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const { party, ledger } = useMemo(() => {
    if (!shopId || !partyId) {
      return {
        party: null,
        ledger: {
          entries: [] as LedgerEntryWithBalance[],
          openingBalance: 0,
          closingBalance: 0,
          totalGiven: 0,
          totalTaken: 0,
        },
      };
    }
    const p = getPartyById(db, shopId, partyId);
    const l = p
      ? listPartyLedger(db, shopId, partyId, { from: range.from, to: range.to, order: 'desc' })
      : { entries: [], openingBalance: 0, closingBalance: 0, totalGiven: 0, totalTaken: 0 };
    return { party: p, ledger: l };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, partyId, range.from, range.to, partiesLive.updatedAt, ledgerLive.updatedAt, cashLive.updatedAt, rev]);

  const canTransact = can(role, 'collectDue');
  const canEdit = can(role, 'manageParties');
  const canDelete = can(role, 'delete');

  const handleCall = async () => {
    try {
      await callPartyPhone(party?.phone);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleWhatsApp = async () => {
    if (!party || !shop) return;
    try {
      await openWhatsAppStatement({
        shopName: shop.name,
        shopPhone: shop.phone,
        party,
        balance: party.balance,
        entries: ledger.entries,
        decimal,
      });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleSms = async () => {
    if (!party || !shop) return;
    try {
      await openSmsStatement({
        shopName: shop.name,
        shopPhone: shop.phone,
        party,
        balance: party.balance,
        entries: ledger.entries,
        decimal,
      });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handlePdf = async () => {
    if (!party || !shop || exportingPdf) return;
    setExportingPdf(true);
    try {
      await shareStatementPdf({
        shop,
        party,
        openingBalance: ledger.openingBalance,
        closingBalance: ledger.closingBalance,
        totalGiven: ledger.totalGiven,
        totalTaken: ledger.totalTaken,
        entries: ledger.entries,
        decimal,
        from: range.from,
        to: range.to,
      });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDeleteEntry = () => {
    if (!deleteTarget) return;
    try {
      const ctx = requireShop();
      deleteLedgerEntry(db, ctx, deleteTarget.id);
      toast.show('Entry deleted and balances reversed', 'success');
      setDeleteTarget(null);
      setRev((r) => r + 1);
    } catch (e) {
      setDeleteTarget(null);
      toast.show(errorMessage(e), 'error');
    }
  };

  const renderEntry = ({ item }: { item: LedgerEntryWithBalance }) => {
    const isGive = item.amount > 0;
    const isManual = item.ref_id === null;
    return (
      <View
        style={[
          styles.entryRow,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.flex}>
          <View style={styles.badgeRow}>
            <Badge
              label={LEDGER_TYPE_LABELS[item.type]}
              tone={isGive ? 'danger' : 'success'}
            />
            {item.method ? <Badge label={METHOD_LABELS[item.method]} tone="neutral" /> : null}
            {!isManual ? <Badge label="Linked" tone="warning" /> : null}
          </View>
          {item.note ? (
            <AppText variant="secondary" numberOfLines={2}>
              {item.note}
            </AppText>
          ) : null}
          <AppText variant="label" muted>
            {formatDateTime(item.date)}
          </AppText>
        </View>

        <View style={styles.entryRight}>
          <AppText bold style={{ color: isGive ? colors.danger : colors.success }}>
            {isGive ? 'Gave ' : 'Got '}
            {formatTaka(Math.abs(item.amount), decimal)}
          </AppText>
          <AppText variant="label" muted>
            Bal: {formatTaka(item.runningBalance, decimal)}
          </AppText>
        </View>

        {isManual && canDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete entry"
            hitSlop={8}
            onPress={() => setDeleteTarget(item)}
            style={styles.delIcon}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  const headerRight = party
    ? [
        ...(canEdit
          ? [{ icon: 'pencil-outline' as IconName, label: 'Edit contact', onPress: () => setEditOpen(true) }]
          : []),
        { icon: 'file-pdf-box' as IconName, label: 'Statement PDF', onPress: () => void handlePdf() },
      ]
    : [];

  return (
    <Screen
      header={<AppHeader title={party?.name ?? 'Party detail'} right={headerRight} />}
      scroll={false}
      padded={false}
    >
      {loadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load party ledger"
          message={loadError.message}
        />
      ) : loading ? (
        <Loading label="Loading ledger…" />
      ) : !party ? (
        <EmptyState
          icon="account-off-outline"
          title="Contact not found"
          message="This contact may have been deleted."
          action={{ label: 'Go back', onPress: () => router.back() }}
        />
      ) : (
        <View style={styles.container}>
          <FlatList
            data={ledger.entries}
            keyExtractor={(item) => item.id}
            renderItem={renderEntry}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View style={styles.top}>
                <Card style={styles.heroCard}>
                  <View style={styles.partyTop}>
                    <View style={styles.flex}>
                      <View style={styles.badgeRow}>
                        <Badge
                          label={party.type.charAt(0).toUpperCase() + party.type.slice(1)}
                          tone="neutral"
                        />
                        {party.phone ? (
                          <AppText variant="secondary" muted>
                            {party.phone}
                          </AppText>
                        ) : null}
                      </View>
                      {party.address ? (
                        <AppText variant="label" muted numberOfLines={2}>
                          {party.address}
                        </AppText>
                      ) : null}
                    </View>
                  </View>

                  <View
                    style={[
                      styles.balanceBox,
                      { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                    ]}
                  >
                    <AppText variant="label" muted>
                      {party.balance > 0
                        ? 'Net Receivable (You will get)'
                        : party.balance < 0
                          ? 'Net Payable (You will give)'
                          : 'Account Settled'}
                    </AppText>
                    <AmountText
                      variant="title"
                      paisa={Math.abs(party.balance)}
                      tone={party.balance > 0 ? 'positive' : party.balance < 0 ? 'negative' : 'auto'}
                      decimal={decimal}
                    />
                  </View>

                  <View style={styles.totalsRow}>
                    <View style={styles.flex}>
                      <AppText variant="label" muted>
                        Total Given (+)
                      </AppText>
                      <AppText bold style={{ color: colors.danger }}>
                        {formatTaka(ledger.totalGiven, decimal)}
                      </AppText>
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="label" muted>
                        Total Got (−)
                      </AppText>
                      <AppText bold style={{ color: colors.success }}>
                        {formatTaka(ledger.totalTaken, decimal)}
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.quickRow}>
                    <QuickAction
                      icon="phone-outline"
                      label="Call"
                      color={colors.accent}
                      onPress={() => void handleCall()}
                      disabled={!party.phone}
                    />
                    <QuickAction
                      icon="whatsapp"
                      label="WhatsApp"
                      color={colors.success}
                      onPress={() => void handleWhatsApp()}
                    />
                    <QuickAction
                      icon="message-text-outline"
                      label="SMS"
                      color={colors.accent}
                      onPress={() => void handleSms()}
                    />
                    <QuickAction
                      icon="file-pdf-box"
                      label={exportingPdf ? 'PDF…' : 'PDF'}
                      color={colors.danger}
                      onPress={() => void handlePdf()}
                      disabled={exportingPdf}
                    />
                  </View>
                </Card>

                <ChipRow options={DATE_PRESET_OPTIONS} value={preset} onChange={setPreset} />

                {preset === 'custom' ? (
                  <View style={styles.dateRow}>
                    <View style={styles.flex}>
                      <DateField label="From" value={customFrom} onChange={setCustomFrom} />
                    </View>
                    <View style={styles.flex}>
                      <DateField label="To" value={customTo} onChange={setCustomTo} />
                    </View>
                  </View>
                ) : null}

                {preset !== 'all' ? (
                  <View style={styles.openingLine}>
                    <AppText variant="label" muted>
                      Opening balance before period:
                    </AppText>
                    <AmountText
                      variant="label"
                      paisa={ledger.openingBalance}
                      tone="auto"
                      decimal={decimal}
                    />
                  </View>
                ) : null}

                <AppText variant="label" muted>
                  Transactions ({ledger.entries.length})
                </AppText>
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                icon="notebook-outline"
                title="No transactions yet"
                message='Tap "You Gave" or "You Got" below to record a transaction.'
              />
            }
          />

          {canTransact ? (
            <View
              style={[
                styles.bottomBar,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.border,
                  paddingBottom: Math.max(insets.bottom, 12),
                },
              ]}
            >
              <Button
                label="You Gave"
                icon="arrow-top-right"
                variant="danger"
                onPress={() => setEntrySheet('give')}
                style={styles.flex}
              />
              <Button
                label="You Got"
                icon="arrow-bottom-left"
                variant="primary"
                onPress={() => setEntrySheet('take')}
                style={styles.flex}
              />
            </View>
          ) : null}

          {entrySheet ? (
            <LedgerEntrySheet
              visible={entrySheet !== null}
              mode={entrySheet}
              party={party}
              decimal={decimal}
              onClose={() => setEntrySheet(null)}
              onSaved={() => setRev((r) => r + 1)}
            />
          ) : null}

          <PartyFormSheet
            visible={editOpen}
            onClose={() => setEditOpen(false)}
            party={party}
            defaultType={party.type}
            onSaved={() => setRev((r) => r + 1)}
            onDeleted={() => router.back()}
          />

          <ConfirmDialog
            visible={deleteTarget !== null}
            title="Delete ledger entry?"
            message="This entry will move to the recycle bin and reverse both the party balance and any linked Cashbox entry."
            confirmLabel="Delete"
            destructive
            onConfirm={handleDeleteEntry}
            onCancel={() => setDeleteTarget(null)}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  listContent: { flexGrow: 1, paddingBottom: 24 },
  top: { padding: 16, gap: 12 },
  heroCard: { gap: 12 },
  partyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  balanceBox: {
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: 2,
  },
  totalsRow: { flexDirection: 'row', gap: 12 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickBtn: {
    flex: 1,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  dateRow: { flexDirection: 'row', gap: 12 },
  openingLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entryRight: { alignItems: 'flex-end', gap: 2 },
  delIcon: { padding: 4 },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
});
