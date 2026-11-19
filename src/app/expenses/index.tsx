import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { categories, expenses } from '@/db/schema';
import {
  DATE_PRESET_OPTIONS,
  resolveDateRange,
  type DatePreset,
} from '@/features/cash/dateFilter';
import { ExpenseFormSheet } from '@/features/expenses/ExpenseFormSheet';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { METHOD_LABELS } from '@/services/cash';
import {
  createExpenseCategory,
  listExpenseCategories,
  listExpenses,
  type ExpenseWithCategory,
} from '@/services/expenses';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AmountText,
  AppHeader,
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  ChipRow,
  DateField,
  EmptyState,
  Fab,
  ListRow,
  Loading,
  Screen,
  SearchBar,
  TextField,
  useToast,
} from '@/ui';

const ALL_CAT = '__all__';
const UNCAT = 'uncategorized';

export default function ExpensesScreen() {
  const { colors } = useTheme();
  const { shopId, shop, role, requireShop } = useCurrentShop();
  const toast = useToast();
  const decimal = Boolean(shop?.decimal_enabled);

  const [preset, setPreset] = useState<DatePreset>('month');
  const [customFrom, setCustomFrom] = useState<number>(() => Date.now());
  const [customTo, setCustomTo] = useState<number>(() => Date.now());
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CAT);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseWithCategory | null>(null);
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [rev, setRev] = useState(0);

  const sid = shopId ?? '';
  const expLive = useLiveQuery(
    expoDb.select({ id: expenses.id }).from(expenses).where(active(expenses, sid)),
    [sid],
  );
  const catLive = useLiveQuery(
    expoDb.select({ id: categories.id }).from(categories).where(active(categories, sid)),
    [sid],
  );

  const loading = !shopId || expLive.updatedAt === undefined || catLive.updatedAt === undefined;
  const loadError = expLive.error ?? catLive.error;

  const range = useMemo(
    () => resolveDateRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const { expenseCategories, result } = useMemo(() => {
    if (!shopId) {
      return {
        expenseCategories: [],
        result: { items: [] as ExpenseWithCategory[], total: 0, byCategory: [] },
      };
    }
    const cats = listExpenseCategories(db, shopId);
    const res = listExpenses(db, shopId, {
      from: range.from,
      to: range.to,
      categoryId: categoryFilter === ALL_CAT ? undefined : categoryFilter,
      search,
    });
    return { expenseCategories: cats, result: res };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, range.from, range.to, categoryFilter, search, expLive.updatedAt, catLive.updatedAt, rev]);

  const canAdd = can(role, 'addExpense');
  const canEdit = can(role, 'delete');

  const categoryChips = [
    { value: ALL_CAT, label: 'All' },
    ...expenseCategories.map((c) => ({ value: c.id, label: c.name })),
    { value: UNCAT, label: 'Uncategorized' },
  ];

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (item: ExpenseWithCategory) => {
    if (!canEdit) return;
    setEditing(item);
    setFormOpen(true);
  };

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    try {
      const ctx = requireShop();
      const created = createExpenseCategory(db, ctx, newCatName);
      setNewCatName('');
      setCatSheetOpen(false);
      toast.show(`Category "${created.name}" added`, 'success');
      setRev((r) => r + 1);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const renderItem = ({ item }: { item: ExpenseWithCategory }) => (
    <ListRow
      title={item.categoryName}
      subtitle={[item.note, formatDateTime(item.date)].filter(Boolean).join(' · ')}
      onPress={canEdit ? () => openEdit(item) : undefined}
      left={
        <View style={[styles.iconTile, { backgroundColor: colors.danger + '1E' }]}>
          <MaterialCommunityIcons name="cash-minus" size={22} color={colors.danger} />
        </View>
      }
      right={
        <View style={styles.rightCol}>
          <AmountText paisa={item.amount} tone="negative" decimal={decimal} />
          <Badge label={METHOD_LABELS[item.method]} tone="neutral" />
        </View>
      }
    />
  );

  return (
    <Screen
      header={
        <AppHeader
          title="Expense ledger"
          right={
            canAdd
              ? [{ icon: 'tag-plus-outline', label: 'New category', onPress: () => setCatSheetOpen(true) }]
              : []
          }
        />
      }
      scroll={false}
      padded={false}
      overlay={canAdd ? <Fab label="Add expense" onPress={openAdd} /> : undefined}
    >
      {loadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load expenses"
          message={loadError.message}
        />
      ) : loading ? (
        <Loading label="Loading expenses…" />
      ) : (
        <FlatList
          data={result.items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.top}>
              <Card style={styles.summaryCard}>
                <View style={styles.summaryTop}>
                  <View>
                    <AppText variant="label" muted>
                      Total Expenses
                    </AppText>
                    <AppText variant="title" style={{ color: colors.danger }}>
                      {formatTaka(result.total, decimal)}
                    </AppText>
                  </View>
                  <Badge
                    label={`${result.items.length} ${result.items.length === 1 ? 'entry' : 'entries'}`}
                    tone="neutral"
                  />
                </View>

                {result.byCategory.length > 0 ? (
                  <View style={styles.breakdown}>
                    {result.byCategory.slice(0, 4).map((b) => (
                      <View
                        key={b.categoryId ?? 'uncat'}
                        style={[styles.catPill, { backgroundColor: colors.surfaceMuted }]}
                      >
                        <AppText variant="label" muted>
                          {b.categoryName}:{' '}
                        </AppText>
                        <AppText variant="label" bold>
                          {formatTaka(b.total, decimal)}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ) : null}
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

              <ChipRow
                options={categoryChips}
                value={categoryFilter}
                onChange={setCategoryFilter}
              />

              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder="Search expense note or category"
              />
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="receipt-text-outline"
              title="No expenses recorded"
              message="Add business expenses like rent, electricity, transport, or staff snacks."
              action={canAdd ? { label: 'Add Expense', onPress: openAdd } : undefined}
            />
          }
        />
      )}

      <ExpenseFormSheet
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        categories={expenseCategories}
        expense={editing}
        onSaved={() => setRev((r) => r + 1)}
      />

      <BottomSheet
        visible={catSheetOpen}
        onClose={() => setCatSheetOpen(false)}
        title="New Expense Category"
      >
        <View style={styles.catSheet}>
          <TextField
            label="Category name *"
            value={newCatName}
            onChangeText={setNewCatName}
            placeholder="e.g. Shop Rent, Utilities, Delivery"
          />
          <View style={styles.sheetActions}>
            <Button
              label="Cancel"
              variant="outline"
              onPress={() => setCatSheetOpen(false)}
              style={styles.flex}
            />
            <Button label="Create" onPress={handleAddCategory} style={styles.flex} />
          </View>
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { flexGrow: 1, paddingBottom: 88 },
  top: { padding: 16, gap: 12 },
  summaryCard: { gap: 10 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.row,
  },
  dateRow: { flexDirection: 'row', gap: 12 },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightCol: { alignItems: 'flex-end', gap: 4 },
  catSheet: { gap: 12, paddingBottom: 8 },
  sheetActions: { flexDirection: 'row', gap: 12 },
});
