import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { parties, party_ledger } from '@/db/schema';
import { PartyFormSheet } from '@/features/contacts/PartyFormSheet';
import { formatTaka } from '@/lib/money';
import { getDueSummary, listParties, type PartyWithBalance } from '@/services/parties';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import {
  AmountText,
  AppHeader,
  AppText,
  Card,
  ChipRow,
  EmptyState,
  Fab,
  ListRow,
  Loading,
  Screen,
  SearchBar,
  Segmented,
} from '@/ui';

type DueTab = 'customer' | 'supplier';
type BalanceFilter = 'due' | 'all' | 'receivable' | 'payable';

const TABS: { value: DueTab; label: string }[] = [
  { value: 'customer', label: 'Customers' },
  { value: 'supplier', label: 'Suppliers' },
];

const FILTERS: { value: BalanceFilter; label: string }[] = [
  { value: 'due', label: 'With due' },
  { value: 'all', label: 'All' },
  { value: 'receivable', label: "You'll get" },
  { value: 'payable', label: "You'll give" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function DueLedgerScreen() {
  const { colors } = useTheme();
  const { shopId, shop, role } = useCurrentShop();
  const decimal = Boolean(shop?.decimal_enabled);

  const [tab, setTab] = useState<DueTab>('customer');
  const [filter, setFilter] = useState<BalanceFilter>('due');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
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

  const loading = !shopId || partiesLive.updatedAt === undefined || ledgerLive.updatedAt === undefined;
  const loadError = partiesLive.error ?? ledgerLive.error;

  const { items, summary } = useMemo(() => {
    if (!shopId) {
      return {
        items: [] as PartyWithBalance[],
        summary: { totalReceivable: 0, totalPayable: 0, netBalance: 0, count: 0 },
      };
    }
    const sum = getDueSummary(db, shopId, tab);
    const list = listParties(db, shopId, {
      type: tab,
      search,
      onlyWithDue: filter === 'due',
      direction: filter === 'receivable' || filter === 'payable' ? filter : undefined,
    });
    return { items: list, summary: sum };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, tab, search, filter, partiesLive.updatedAt, ledgerLive.updatedAt, rev]);

  const canManage = can(role, 'manageParties');

  const openParty = (p: PartyWithBalance) => {
    router.push({ pathname: '/party/[id]', params: { id: p.id } });
  };

  const renderItem = ({ item }: { item: PartyWithBalance }) => {
    const statusLabel =
      item.balance > 0 ? "You'll get" : item.balance < 0 ? "You'll give" : 'Settled';
    return (
      <ListRow
        title={item.name}
        subtitle={item.phone ?? (item.address || 'Tap to view ledger')}
        onPress={() => openParty(item)}
        left={
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
            <AppText variant="secondary" bold style={{ color: colors.text }}>
              {initials(item.name)}
            </AppText>
          </View>
        }
        right={
          <View style={styles.rightCol}>
            <AmountText paisa={Math.abs(item.balance)} tone={item.balance > 0 ? 'positive' : item.balance < 0 ? 'negative' : 'auto'} decimal={decimal} />
            <AppText variant="label" muted>
              {statusLabel}
            </AppText>
          </View>
        }
      />
    );
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Due ledger"
          right={
            canManage
              ? [{ icon: 'account-plus-outline', label: 'Add contact', onPress: () => setFormOpen(true) }]
              : []
          }
        />
      }
      scroll={false}
      padded={false}
      overlay={
        canManage ? (
          <Fab label={`Add ${tab}`} onPress={() => setFormOpen(true)} />
        ) : undefined
      }
    >
      {loadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load due ledger"
          message={loadError.message}
        />
      ) : loading ? (
        <Loading label="Loading dues…" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.top}>
              <View style={styles.tabRow}>
                <Segmented options={TABS} value={tab} onChange={setTab} />
                <AppText variant="label" muted>
                  {summary.count} with due
                </AppText>
              </View>

              <Card style={styles.summaryCard}>
                <View style={styles.statBox}>
                  <View style={styles.statHead}>
                    <MaterialCommunityIcons
                      name="arrow-bottom-left"
                      size={16}
                      color={colors.success}
                    />
                    <AppText variant="label" muted>
                      Receivable (You&apos;ll get)
                    </AppText>
                  </View>
                  <AppText variant="title" style={{ color: colors.success }}>
                    {formatTaka(summary.totalReceivable, decimal)}
                  </AppText>
                </View>

                <View style={[styles.vSep, { backgroundColor: colors.border }]} />

                <View style={styles.statBox}>
                  <View style={styles.statHead}>
                    <MaterialCommunityIcons
                      name="arrow-top-right"
                      size={16}
                      color={colors.danger}
                    />
                    <AppText variant="label" muted>
                      Payable (You&apos;ll give)
                    </AppText>
                  </View>
                  <AppText variant="title" style={{ color: colors.danger }}>
                    {formatTaka(summary.totalPayable, decimal)}
                  </AppText>
                </View>
              </Card>

              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder={`Search ${tab}s by name or phone`}
              />

              <ChipRow options={FILTERS} value={filter} onChange={setFilter} />
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="book-account-outline"
              title={filter === 'due' ? `No ${tab}s with due` : `No ${tab}s found`}
              message={
                filter === 'due'
                  ? 'Switch to "All" or add a new contact to record Give / Take entries.'
                  : `Add your first ${tab} to start tracking dues.`
              }
              action={
                canManage
                  ? { label: `Add ${tab}`, onPress: () => setFormOpen(true) }
                  : undefined
              }
            />
          }
        />
      )}

      <PartyFormSheet
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        defaultType={tab}
        onSaved={() => setRev((r) => r + 1)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { flexGrow: 1, paddingBottom: 88 },
  top: { padding: 16, gap: 12 },
  tabRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statBox: { flex: 1, gap: 4 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vSep: { width: 1, alignSelf: 'stretch' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightCol: { alignItems: 'flex-end', gap: 2 },
});
