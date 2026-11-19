import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { formatTaka } from '@/lib/money';
import {
  listProductCategories,
  listProductsWithStock,
  type ProductWithStock,
} from '@/services/products';
import { ProductThumb } from '@/features/products/ProductThumb';
import {
  AppText,
  Badge,
  BottomSheet,
  Button,
  ChipRow,
  EmptyState,
  ListRow,
  MoneyInput,
  QtyStepper,
  SearchBar,
  TextField,
  useToast,
} from '@/ui';

export function ProductPickerSheet({
  visible,
  shopId,
  decimal,
  rev,
  cartQtyByProductId,
  onClose,
  onPickProduct,
  onAddCustomItem,
}: {
  visible: boolean;
  shopId: string | null;
  decimal: boolean;
  rev: number;
  cartQtyByProductId: ReadonlyMap<string, number>;
  onClose: () => void;
  onPickProduct: (product: ProductWithStock) => void;
  onAddCustomItem: (item: { name: string; qty: number; unitPrice: number }) => void;
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customQty, setCustomQty] = useState(1);
  const [customPrice, setCustomPrice] = useState<number | null>(null);

  const categories = useMemo(() => {
    if (!visible || !shopId) return [];
    void rev;
    return listProductCategories(db, shopId);
  }, [visible, shopId, rev]);

  const products = useMemo(() => {
    if (!visible || !shopId) return [];
    void rev;
    return listProductsWithStock(db, shopId, {
      search,
      categoryId: categoryId === 'all' ? null : categoryId,
    });
  }, [visible, shopId, search, categoryId, rev]);

  const categoryOptions = useMemo(
    () => [{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
    [categories],
  );

  const handleAddCustom = () => {
    const trimmed = customName.trim();
    if (!trimmed) {
      toast.show('Enter item name', 'error');
      return;
    }
    if (customQty <= 0) {
      toast.show('Quantity must be greater than zero', 'error');
      return;
    }
    onAddCustomItem({
      name: trimmed,
      qty: customQty,
      unitPrice: customPrice ?? 0,
    });
    setCustomName('');
    setCustomQty(1);
    setCustomPrice(null);
    setCustomMode(false);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        setCustomMode(false);
        onClose();
      }}
      title={customMode ? 'Custom purchase item' : 'Add products to buy'}
    >
      {customMode ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
          <TextField
            label="Item name *"
            placeholder="e.g. Packaging boxes"
            value={customName}
            onChangeText={setCustomName}
            autoFocus
          />
          <View style={styles.qtyRow}>
            <AppText variant="secondary" muted>
              Quantity
            </AppText>
            <QtyStepper value={customQty} onChange={setCustomQty} min={0.001} step={1} />
          </View>
          <MoneyInput
            label="Unit buy price"
            value={customPrice}
            onChange={setCustomPrice}
            placeholder="0"
          />
          <View style={styles.actions}>
            <Button
              label="Back"
              variant="outline"
              onPress={() => setCustomMode(false)}
              style={styles.flex}
            />
            <Button label="Add item" onPress={handleAddCustom} style={styles.flex} />
          </View>
        </ScrollView>
      ) : (
        <View style={styles.wrap}>
          <View style={styles.topRow}>
            <View style={styles.flex}>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder="Search products or code"
              />
            </View>
            <Button
              label="Custom"
              variant="outline"
              icon="pencil-plus"
              onPress={() => setCustomMode(true)}
            />
          </View>

          {categories.length > 0 ? (
            <ChipRow options={categoryOptions} value={categoryId} onChange={setCategoryId} />
          ) : null}

          <View style={styles.listWrap}>
            <FlatList
              data={products}
              keyExtractor={(p) => p.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <EmptyState
                  icon="package-variant"
                  title="No products found"
                  message="Add products in Product list or tap Custom above."
                />
              }
              renderItem={({ item }) => {
                const inCart = cartQtyByProductId.get(item.id) ?? 0;
                return (
                  <ListRow
                    title={item.name}
                    subtitle={`Buy ${formatTaka(item.buy_price, decimal)} · Stock ${item.stock} ${item.unit}`}
                    left={<ProductThumb uri={item.image_uri} size={42} />}
                    right={
                      inCart > 0 ? (
                        <Badge label={`In cart: ${inCart}`} tone="success" />
                      ) : (
                        <Badge label="+ Add" tone="warning" />
                      )
                    }
                    onPress={() => {
                      onPickProduct(item);
                      toast.show(`Added ${item.name}`, 'info');
                    }}
                  />
                );
              }}
            />
          </View>

          <Button label="Done" variant="primary" fullWidth onPress={onClose} />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listWrap: { maxHeight: 340, minHeight: 150 },
  form: { gap: 12, paddingBottom: 12 },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
