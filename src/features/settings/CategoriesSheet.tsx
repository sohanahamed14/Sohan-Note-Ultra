import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Category, Role } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '@/services/shop';
import { useTheme } from '@/theme';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  ListRow,
  Segmented,
  TextField,
  useToast,
} from '@/ui';

function CategoriesBody({
  shopId,
  userId,
  role,
}: {
  shopId: string;
  userId: string | null;
  role: Role;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [kind, setKind] = useState<'product' | 'expense'>('product');
  const [items, setItems] = useState<Category[]>(() => listCategories(db, shopId, 'product'));
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const reload = (nextKind: 'product' | 'expense' = kind) => {
    setItems(listCategories(db, shopId, nextKind));
  };

  const handleSubmit = () => {
    try {
      if (editing) {
        updateCategory(db, shopId, role, editing.id, { name });
        toast.show('Category updated', 'success');
        setEditing(null);
      } else {
        createCategory(db, shopId, userId, role, { name, kind });
        toast.show('Category added', 'success');
      }
      setName('');
      reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleConfirmDelete = () => {
    if (!deleting) return;
    try {
      deleteCategory(db, shopId, role, deleting.id);
      toast.show('Category moved to recycle bin', 'success');
      if (editing?.id === deleting.id) {
        setEditing(null);
        setName('');
      }
      setDeleting(null);
      reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <>
      <Segmented
        options={[
          { value: 'product', label: 'Products' },
          { value: 'expense', label: 'Expenses' },
        ]}
        value={kind}
        onChange={(v) => {
          setKind(v);
          setEditing(null);
          setName('');
          reload(v);
        }}
      />

      <View style={styles.addRow}>
        <View style={styles.flex}>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={
              editing
                ? 'Rename category'
                : kind === 'product'
                  ? 'New product category'
                  : 'New expense category'
            }
          />
        </View>
        <Button label={editing ? 'Update' : 'Add'} onPress={handleSubmit} />
        {editing ? (
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => {
              setEditing(null);
              setName('');
            }}
          />
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="tag-outline"
            title={`No ${kind} categories yet`}
            message="Add categories to organize products and expenses."
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            left={<MaterialCommunityIcons name="tag-outline" size={20} color={colors.accent} />}
            right={
              <View style={styles.rowActions}>
                <Pressable
                  accessibilityLabel={`Edit ${item.name}`}
                  onPress={() => {
                    setEditing(item);
                    setName(item.name);
                  }}
                  hitSlop={8}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.accent} />
                </Pressable>
                <Pressable
                  accessibilityLabel={`Delete ${item.name}`}
                  onPress={() => setDeleting(item)}
                  hitSlop={8}
                >
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={20}
                    color={colors.danger}
                  />
                </Pressable>
              </View>
            }
          />
        )}
      />

      <ConfirmDialog
        visible={Boolean(deleting)}
        title="Delete category?"
        message={`"${deleting?.name ?? ''}" will be moved to the recycle bin.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

export function CategoriesSheet({
  visible,
  onClose,
  shopId,
  userId,
  role,
}: {
  visible: boolean;
  onClose: () => void;
  shopId: string;
  userId: string | null;
  role: Role;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Custom categories">
      {visible ? <CategoriesBody shopId={shopId} userId={userId} role={role} /> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  list: { maxHeight: 320 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
