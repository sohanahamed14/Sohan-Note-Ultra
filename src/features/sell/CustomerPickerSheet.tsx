import { MaterialCommunityIcons } from '@expo/vector-icons';
import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { parties, type Party } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { can } from '@/services/permissions';
import { listCustomerOptions, quickCreateCustomer } from '@/services/sales';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppText,
  BottomSheet,
  Button,
  Divider,
  EmptyState,
  ListRow,
  SearchBar,
  TextField,
  useToast,
} from '@/ui';

type Props = {
  visible: boolean;
  selectedId: string | null;
  onSelect: (party: Party | null) => void;
  onClose: () => void;
};

export function CustomerPickerSheet({ visible, selectedId, onSelect, onClose }: Props) {
  const { colors } = useTheme();
  const { shopId, role, requireShop } = useCurrentShop();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [formError, setFormError] = useState<string | undefined>();

  const { updatedAt } = useLiveQuery(
    expoDb
      .select({ id: parties.id })
      .from(parties)
      .where(and(active(parties, shopId ?? ''), eq(parties.type, 'customer'))),
    [shopId],
  );

  const customers = useMemo(() => {
    if (!shopId) return [];
    void updatedAt;
    return listCustomerOptions(db, shopId, search);
  }, [shopId, search, updatedAt]);

  const canAdd = can(role, 'manageParties');

  const handleCreate = () => {
    try {
      setFormError(undefined);
      const ctx = requireShop();
      const created = quickCreateCustomer(db, ctx, {
        name: newName,
        phone: newPhone.trim() || null,
      });
      toast.show(`Added ${created.name}`, 'success');
      setNewName('');
      setNewPhone('');
      setAdding(false);
      onSelect(created);
      onClose();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Select Customer">
      {adding ? (
        <View style={styles.form}>
          <TextField
            label="Customer name *"
            placeholder="e.g. Rahim Uddin"
            value={newName}
            onChangeText={setNewName}
            error={formError}
            autoFocus
          />
          <TextField
            label="Phone (optional)"
            placeholder="01XXXXXXXXX"
            value={newPhone}
            onChangeText={setNewPhone}
            keyboardType="phone-pad"
          />
          <View style={styles.formActions}>
            <Button
              label="Cancel"
              variant="outline"
              onPress={() => {
                setAdding(false);
                setFormError(undefined);
              }}
              style={styles.flex}
            />
            <Button label="Save & Select" onPress={handleCreate} style={styles.flex} />
          </View>
        </View>
      ) : (
        <View style={styles.body}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer name or phone"
          />

          <View style={styles.quickRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onSelect(null);
                onClose();
              }}
              style={[
                styles.walkIn,
                {
                  backgroundColor: selectedId === null ? colors.primarySoft : colors.surfaceMuted,
                  borderColor: selectedId === null ? colors.primary : colors.border,
                },
              ]}
            >
              <MaterialCommunityIcons name="account-outline" size={18} color={colors.text} />
              <AppText variant="secondary" bold={selectedId === null}>
                Walk-in
              </AppText>
            </Pressable>
            {canAdd ? (
              <Button
                label="New customer"
                icon="account-plus-outline"
                variant="outline"
                onPress={() => setAdding(true)}
                style={styles.flex}
              />
            ) : null}
          </View>

          <Divider />

          <FlatList
            data={customers}
            keyExtractor={(item) => item.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <EmptyState
                icon="account-search-outline"
                title="No customers found"
                message={
                  canAdd
                    ? 'Tap "New customer" to add one right away.'
                    : 'No matching customers in this shop.'
                }
              />
            }
            renderItem={({ item }) => {
              const isSelected = item.id === selectedId;
              return (
                <ListRow
                  title={item.name}
                  subtitle={item.phone ?? item.address ?? 'Customer'}
                  left={
                    <View
                      style={[
                        styles.avatar,
                        { backgroundColor: isSelected ? colors.primary : colors.surfaceMuted },
                      ]}
                    >
                      <AppText bold style={{ color: isSelected ? colors.onPrimary : colors.text }}>
                        {item.name.slice(0, 1).toUpperCase()}
                      </AppText>
                    </View>
                  }
                  right={
                    isSelected ? (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={22}
                        color={colors.success}
                      />
                    ) : null
                  }
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                />
              );
            }}
          />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  quickRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  walkIn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  list: { maxHeight: 320 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: { gap: 12 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
});
