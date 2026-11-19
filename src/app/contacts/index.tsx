import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { parties, party_ledger } from '@/db/schema';
import { PartyFormSheet } from '@/features/contacts/PartyFormSheet';
import { callPartyPhone } from '@/features/due/statementActions';
import { errorMessage } from '@/lib/errors';
import { listParties, type PartyType, type PartyWithBalance } from '@/services/parties';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import {
  AmountText,
  AppHeader,
  AppText,
  EmptyState,
  Fab,
  ListRow,
  Loading,
  Screen,
  SearchBar,
  Segmented,
  useToast,
} from '@/ui';

const TYPE_TABS: { value: PartyType; label: string }[] = [
  { value: 'customer', label: 'Customers' },
  { value: 'supplier', label: 'Suppliers' },
  { value: 'employee', label: 'Employees' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function ContactsScreen() {
  const { colors } = useTheme();
  const { shopId, shop, role } = useCurrentShop();
  const toast = useToast();
  const decimal = Boolean(shop?.decimal_enabled);

  const [tab, setTab] = useState<PartyType>('customer');
  const [search, setSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<PartyWithBalance | null>(null);
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

  const items = useMemo(() => {
    if (!shopId) return [];
    return listParties(db, shopId, { type: tab, search });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, tab, search, partiesLive.updatedAt, ledgerLive.updatedAt, rev]);

  const canManage = can(role, 'manageParties');

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const openEdit = (p: PartyWithBalance) => {
    setEditing(p);
    setSheetOpen(true);
  };

  const handleCall = async (phone: string | null) => {
    try {
      await callPartyPhone(phone);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const avatarTint =
    tab === 'customer' ? colors.accent : tab === 'supplier' ? colors.success : colors.primary;

  const renderItem = ({ item }: { item: PartyWithBalance }) => {
    const subParts = [item.phone, item.address].filter(Boolean);
    return (
      <ListRow
        title={item.name}
        subtitle={subParts.length > 0 ? subParts.join(' · ') : 'Tap to open ledger'}
        onPress={() => router.push({ pathname: '/party/[id]', params: { id: item.id } })}
        left={
          <View style={[styles.avatar, { backgroundColor: avatarTint + '22' }]}>
            <AppText
              variant="secondary"
              bold
              style={{ color: tab === 'employee' ? colors.text : avatarTint }}
            >
              {initials(item.name)}
            </AppText>
          </View>
        }
        right={
          <View style={styles.rightRow}>
            {item.balance !== 0 ? (
              <AmountText
                variant="secondary"
                paisa={item.balance}
                tone="auto"
                decimal={decimal}
              />
            ) : null}
            {item.phone ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${item.name}`}
                hitSlop={8}
                onPress={() => void handleCall(item.phone)}
                style={styles.iconBtn}
              >
                <MaterialCommunityIcons name="phone-outline" size={20} color={colors.accent} />
              </Pressable>
            ) : null}
            {canManage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
                hitSlop={8}
                onPress={() => openEdit(item)}
                style={styles.iconBtn}
              >
                <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        }
      />
    );
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Contacts"
          right={
            canManage
              ? [{ icon: 'account-plus-outline', label: 'Add contact', onPress: openCreate }]
              : []
          }
        />
      }
      scroll={false}
      padded={false}
      overlay={canManage ? <Fab label="Add contact" onPress={openCreate} /> : undefined}
    >
      {loadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load contacts"
          message={loadError.message}
        />
      ) : loading ? (
        <Loading label="Loading contacts…" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.top}>
              <Segmented options={TYPE_TABS} value={tab} onChange={setTab} />
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder={`Search ${tab}s by name or phone`}
              />
              <AppText variant="label" muted>
                {items.length} {tab}
                {items.length === 1 ? '' : 's'}
              </AppText>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="account-group-outline"
              title={`No ${tab}s yet`}
              message={`Add your first ${tab} to manage contact details and balances.`}
              action={canManage ? { label: `Add ${tab}`, onPress: openCreate } : undefined}
            />
          }
        />
      )}

      <PartyFormSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        defaultType={tab}
        party={editing}
        onSaved={() => setRev((r) => r + 1)}
        onDeleted={() => setRev((r) => r + 1)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { flexGrow: 1, paddingBottom: 88 },
  top: { padding: 16, gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { padding: 6 },
});
