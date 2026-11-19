import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { METHODS, type Category, type Method } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { METHOD_LABELS } from '@/services/cash';
import {
  addExpense,
  createExpenseCategory,
  deleteExpense,
  updateExpense,
  type ExpenseWithCategory,
} from '@/services/expenses';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import {
  AppText,
  BottomSheet,
  Button,
  ChipRow,
  ConfirmDialog,
  DateField,
  MoneyInput,
  TextField,
  useToast,
} from '@/ui';

const METHOD_OPTIONS: { value: Method; label: string }[] = METHODS.map((m) => ({
  value: m,
  label: METHOD_LABELS[m],
}));

const NONE_CAT = '__none__';

type Props = {
  visible: boolean;
  onClose: () => void;
  categories: Category[];
  expense?: ExpenseWithCategory | null;
  onSaved: () => void;
};

function ExpenseFormBody({
  onClose,
  categories,
  expense,
  onSaved,
  onRequestDelete,
}: {
  onClose: () => void;
  categories: Category[];
  expense: ExpenseWithCategory | null;
  onSaved: () => void;
  onRequestDelete: () => void;
}) {
  const { requireShop, role } = useCurrentShop();
  const toast = useToast();

  const [amount, setAmount] = useState<number | null>(expense?.amount ?? null);
  const [categoryId, setCategoryId] = useState<string>(expense?.category_id ?? NONE_CAT);
  const [method, setMethod] = useState<Method>(expense?.method ?? 'cash');
  const [date, setDate] = useState<number>(() => expense?.date ?? Date.now());
  const [note, setNote] = useState(expense?.note ?? '');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const catOptions = [
    { value: NONE_CAT, label: 'Uncategorized' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  const handleCreateCategory = () => {
    if (!newCatName.trim()) return;
    try {
      const ctx = requireShop();
      const created = createExpenseCategory(db, ctx, newCatName);
      setCategoryId(created.id);
      setNewCatName('');
      setAddingCat(false);
      toast.show(`Category "${created.name}" created`, 'success');
      onSaved();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleSave = () => {
    if (!amount || amount <= 0) {
      setAmountError('Enter an amount greater than 0');
      return;
    }
    setAmountError(undefined);
    setSaving(true);
    try {
      const ctx = requireShop();
      const cat = categoryId === NONE_CAT ? null : categoryId;
      if (expense) {
        updateExpense(db, ctx, expense.id, { amount, categoryId: cat, method, date, note });
        toast.show('Expense updated', 'success');
      } else {
        addExpense(db, ctx, { amount, categoryId: cat, method, date, note });
        toast.show('Expense added', 'success');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
      <MoneyInput
        label="Amount *"
        value={amount}
        onChange={(v) => {
          setAmount(v);
          if (amountError) setAmountError(undefined);
        }}
        error={amountError}
      />

      <View style={styles.field}>
        <View style={styles.catHeader}>
          <AppText variant="secondary" muted>
            Category
          </AppText>
          <Button
            label={addingCat ? 'Hide' : '+ New category'}
            variant="ghost"
            onPress={() => setAddingCat((v) => !v)}
            style={styles.smallBtn}
          />
        </View>
        <ChipRow options={catOptions} value={categoryId} onChange={setCategoryId} />
      </View>

      {addingCat ? (
        <View style={styles.inlineRow}>
          <View style={styles.flex}>
            <TextField
              value={newCatName}
              onChangeText={setNewCatName}
              placeholder="e.g. Rent, Electricity, Transport"
            />
          </View>
          <Button label="Add" onPress={handleCreateCategory} />
        </View>
      ) : null}

      <View style={styles.field}>
        <AppText variant="secondary" muted>
          Payment method
        </AppText>
        <ChipRow options={METHOD_OPTIONS} value={method} onChange={setMethod} />
      </View>

      <DateField label="Date" value={date} onChange={setDate} />

      <TextField
        label="Note"
        value={note}
        onChangeText={setNote}
        placeholder="What was this expense for?"
      />

      <View style={styles.actions}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label={expense ? 'Update' : 'Save Expense'}
          onPress={handleSave}
          loading={saving}
          style={styles.flex}
        />
      </View>

      {expense && can(role, 'delete') ? (
        <Button
          label="Delete Expense"
          variant="ghost"
          icon="trash-can-outline"
          onPress={onRequestDelete}
          fullWidth
        />
      ) : null}
    </ScrollView>
  );
}

export function ExpenseFormSheet({
  visible,
  onClose,
  categories,
  expense = null,
  onSaved,
}: Props) {
  const { requireShop } = useCurrentShop();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (!expense) return;
    try {
      const ctx = requireShop();
      deleteExpense(db, ctx, expense.id);
      toast.show('Expense moved to recycle bin', 'success');
      setConfirmDelete(false);
      onClose();
      onSaved();
    } catch (e) {
      setConfirmDelete(false);
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <>
      <BottomSheet
        visible={visible && !confirmDelete}
        onClose={onClose}
        title={expense ? 'Edit Expense' : 'Add Expense'}
      >
        {visible ? (
          <ExpenseFormBody
            key={expense?.id ?? 'new'}
            onClose={onClose}
            categories={categories}
            expense={expense}
            onSaved={onSaved}
            onRequestDelete={() => setConfirmDelete(true)}
          />
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete expense?"
        message="This expense will move to the recycle bin and its Cashbox deduction will be reversed."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, paddingBottom: 16 },
  field: { gap: 4 },
  catHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  smallBtn: { minHeight: 32, paddingHorizontal: 8 },
  inlineRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
