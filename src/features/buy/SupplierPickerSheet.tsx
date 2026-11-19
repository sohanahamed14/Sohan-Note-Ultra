import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Party } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { listSuppliers, quickAddSupplier } from '@/services/purchases';
import type { ServiceCtx } from '@/services/stock';
import { useTheme } from '@/theme';
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

export function SupplierPickerSheet({
  visible,
  shopId,
  ctx,
  selectedId,
  rev,
  onClose,
  onSelect,
}: {
  visible: boolean;
  shopId: string | null;
  ctx: ServiceCtx | null;
  selectedId: string | null;
  rev: number;
  onClose: () => void;
  onSelect: (supplier: Party | null) => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const suppliers = useMemo(() => {
    if (!visible || !shopId) return [];
    void rev;
    return listSuppliers(db, shopId, search);
  }, [visible, shopId, search, rev]);

  const handleQuickAdd = () => {
    if (!ctx) return;
    setSaving(true);
    try {
      const created = quickAddSupplier(db, ctx, {
        name,
        phone: phone || null,
        address: address || null,
      });
      toast.show(`Supplier "${created.name}" added`, 'success');
      setName('');
      setPhone('');
      setAddress('');
      setAdding(false);
      onSelect(created);
      onClose();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        setAdding(false);
        onClose();
      }}
      title={adding ? 'New supplier' : 'Select supplier'}
    >
      {adding ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
          <TextField
            label="Supplier name *"
            placeholder="e.g. Dhaka Wholesale"
            value={name}
            onChangeText={setName}
            autoFocus
          />
          <TextField
            label="Phone"
            placeholder="01XXXXXXXXX"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <TextField
            label="Address"
            placeholder="Market / area"
            value={address}
            onChangeText={setAddress}
          />
          <View style={styles.actions}>
            <Button
              label="Back"
              variant="outline"
              onPress={() => setAdding(false)}
              style={styles.flex}
            />
            <Button
              label="Add & select"
              onPress={handleQuickAdd}
              loading={saving}
              style={styles.flex}
            />
          </View>
        </ScrollView>
      ) : (
        <View style={styles.wrap}>
          <View style={styles.topRow}>
            <View style={styles.flex}>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder="Search supplier name or phone"
              />
            </View>
            <Button
              label="New"
              variant="yellow"
              icon="account-plus"
              onPress={() => setAdding(true)}
            />
          </View>

          <ListRow
            title="Walk-in / Cash Supplier"
            subtitle="No due ledger (full cash payment only)"
            left={
              <MaterialCommunityIcons
                name="storefront-outline"
                size={24}
                color={colors.textMuted}
              />
            }
            right={
              selectedId === null ? (
                <MaterialCommunityIcons name="check-circle" size={22} color={colors.accent} />
              ) : null
            }
            onPress={() => {
              onSelect(null);
              onClose();
            }}
          />
          <Divider />

          <View style={styles.listWrap}>
            <FlatList
              data={suppliers}
              keyExtractor={(s) => s.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <EmptyState
                  icon="truck-outline"
                  title="No suppliers found"
                  message="Tap New to add a supplier."
                />
              }
              renderItem={({ item }) => (
                <ListRow
                  title={item.name}
                  subtitle={[item.phone, item.address].filter(Boolean).join(' · ') || 'Supplier'}
                  left={
                    <MaterialCommunityIcons name="truck" size={22} color={colors.accent} />
                  }
                  right={
                    selectedId === item.id ? (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={22}
                        color={colors.accent}
                      />
                    ) : (
                      <AppText variant="label" muted>
                        Select
                      </AppText>
                    )
                  }
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                />
              )}
            />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listWrap: { maxHeight: 340, minHeight: 140 },
  form: { gap: 12, paddingBottom: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
