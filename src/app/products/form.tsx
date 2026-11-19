import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Category } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { can } from '@/services/permissions';
import {
  createProduct,
  createProductCategory,
  deleteProduct,
  getProductById,
  listProductCategories,
  updateProduct,
  type ProductWithStock,
  type ServiceCtx,
} from '@/services/products';
import { useCurrentShop } from '@/store/useCurrentShop';
import { ProductThumb } from '@/features/products/ProductThumb';
import { pickProductImage, uploadProductImageIfOnline } from '@/features/products/productImage';
import { useTableRevision } from '@/features/products/useTableRevision';
import { AdjustStockSheet } from '@/features/stock/AdjustStockSheet';
import {
  AppHeader,
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Divider,
  EmptyState,
  Loading,
  MoneyInput,
  Screen,
  SectionCard,
  SettingsRow,
  TextField,
  useToast,
} from '@/ui';

const UNIT_PRESETS = ['pcs', 'kg', 'gm', 'ltr', 'box', 'pack', 'dozen'] as const;
const WARRANTY_PRESETS = [
  { label: 'None', days: 0 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6m', days: 180 },
  { label: '1 yr', days: 365 },
] as const;
const WATCHED_TABLES = ['products', 'stock_movements', 'categories'] as const;

function ProductEditorBody({
  existing,
  categories,
  ctx,
  canViewCost,
  canDelete,
  canAdjust,
  decimal,
  onRefresh,
}: {
  existing: ProductWithStock | null;
  categories: Category[];
  ctx: ServiceCtx;
  canViewCost: boolean;
  canDelete: boolean;
  canAdjust: boolean;
  decimal: boolean;
  onRefresh: () => void;
}) {
  const isEdit = existing !== null;
  const toast = useToast();

  const [name, setName] = useState(existing?.name ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(existing?.category_id ?? null);
  const [unit, setUnit] = useState(existing?.unit ?? 'pcs');
  const [code, setCode] = useState(existing?.code ?? '');
  const [buyPrice, setBuyPrice] = useState<number | null>(existing ? existing.buy_price : null);
  const [sellPrice, setSellPrice] = useState<number | null>(existing ? existing.sell_price : null);
  const [wholesalePrice, setWholesalePrice] = useState<number | null>(
    existing ? existing.wholesale_price : null,
  );
  const [openingStock, setOpeningStock] = useState('');
  const [lowStockAlert, setLowStockAlert] = useState(
    existing && existing.low_stock_alert > 0 ? String(existing.low_stock_alert) : '',
  );
  const [warrantyDays, setWarrantyDays] = useState(String(existing?.warranty_days ?? 0));
  const [imageUri, setImageUri] = useState<string | null>(existing?.image_uri ?? null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [onlineVisible, setOnlineVisible] = useState(existing?.online_visible === 1);
  const [featured, setFeatured] = useState(existing?.featured === 1);

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);

  const handlePickImage = async (source: 'library' | 'camera') => {
    try {
      const picked = await pickProductImage(source);
      if (picked) {
        setImageUri(picked.uri);
        setImageMime(picked.mimeType);
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleCreateCategory = () => {
    try {
      const created = createProductCategory(db, ctx, newCatName);
      setCategoryId(created.id);
      setNewCatName('');
      setCatSheetOpen(false);
      onRefresh();
      toast.show(`Category "${created.name}" added`, 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const parseNonNegNum = (text: string, label: string): number => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`Invalid ${label}`);
    }
    return n;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsedLowAlert = parseNonNegNum(lowStockAlert, 'low-stock alert');
      const parsedWarranty = Math.floor(parseNonNegNum(warrantyDays, 'warranty days'));
      const parsedOpening = isEdit ? 0 : parseNonNegNum(openingStock, 'opening stock');

      if (isEdit && existing) {
        const finalUri = imageUri
          ? await uploadProductImageIfOnline(ctx.shopId, existing.id, imageUri, imageMime)
          : null;
        updateProduct(db, ctx, existing.id, {
          name,
          category_id: categoryId,
          unit: unit.trim() || 'pcs',
          code: code || null,
          buy_price: buyPrice ?? 0,
          sell_price: sellPrice ?? 0,
          wholesale_price: wholesalePrice ?? 0,
          low_stock_alert: parsedLowAlert,
          warranty_days: parsedWarranty,
          image_uri: finalUri,
          description: description || null,
          online_visible: onlineVisible,
          featured,
        });
        toast.show('Product updated', 'success');
      } else {
        const created = createProduct(db, ctx, {
          name,
          category_id: categoryId,
          unit: unit.trim() || 'pcs',
          code: code || null,
          buy_price: buyPrice ?? 0,
          sell_price: sellPrice ?? 0,
          wholesale_price: wholesalePrice ?? 0,
          opening_stock: parsedOpening,
          low_stock_alert: parsedLowAlert,
          warranty_days: parsedWarranty,
          image_uri: imageUri,
          description: description || null,
          online_visible: onlineVisible,
          featured,
        });
        if (imageUri && !/^https?:\/\//i.test(imageUri)) {
          const uploadedUrl = await uploadProductImageIfOnline(
            ctx.shopId,
            created.id,
            imageUri,
            imageMime,
          );
          if (uploadedUrl !== imageUri) {
            updateProduct(db, ctx, created.id, { image_uri: uploadedUrl });
          }
        }
        toast.show('Product added', 'success');
      }
      router.back();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!existing) return;
    try {
      deleteProduct(db, ctx, existing.id);
      setConfirmDelete(false);
      toast.show('Product moved to Recycle Bin', 'success');
      router.back();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const margin =
    canViewCost && (sellPrice ?? 0) > 0 && (buyPrice ?? 0) > 0
      ? (sellPrice ?? 0) - (buyPrice ?? 0)
      : null;

  return (
    <>
      <SectionCard title="Product photo">
        <View style={styles.photoRow}>
          <ProductThumb uri={imageUri} size={80} />
          <View style={styles.photoActions}>
            <View style={styles.rowGap}>
              <Button
                label="Gallery"
                variant="outline"
                icon="image-outline"
                onPress={() => void handlePickImage('library')}
                style={styles.flex}
              />
              <Button
                label="Camera"
                variant="outline"
                icon="camera-outline"
                onPress={() => void handlePickImage('camera')}
                style={styles.flex}
              />
            </View>
            {imageUri ? (
              <Button
                label="Remove photo"
                variant="ghost"
                icon="close"
                onPress={() => setImageUri(null)}
              />
            ) : null}
          </View>
        </View>
      </SectionCard>

      <SectionCard title="Basic details">
        <View style={styles.colGap}>
          <TextField
            label="Product name *"
            placeholder="e.g. Miniket Rice 5kg"
            value={name}
            onChangeText={setName}
          />

          <View style={styles.catSection}>
            <AppText variant="secondary" muted>
              Category
            </AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              <Chip
                label="None"
                selected={categoryId === null}
                onPress={() => setCategoryId(null)}
              />
              {categories.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  selected={categoryId === c.id}
                  onPress={() => setCategoryId(c.id)}
                />
              ))}
              <Chip label="+ New" onPress={() => setCatSheetOpen(true)} />
            </ScrollView>
          </View>

          <View style={styles.catSection}>
            <AppText variant="secondary" muted>
              Unit
            </AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {UNIT_PRESETS.map((u) => (
                <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
              ))}
            </ScrollView>
          </View>

          <View style={styles.rowGap}>
            <View style={styles.flex}>
              <TextField label="Unit label" placeholder="pcs" value={unit} onChangeText={setUnit} />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Product code / SKU"
                placeholder="Optional"
                value={code}
                onChangeText={setCode}
              />
            </View>
          </View>
        </View>
      </SectionCard>

      <SectionCard title="Pricing">
        <View style={styles.colGap}>
          <View style={styles.rowGap}>
            {canViewCost ? (
              <View style={styles.flex}>
                <MoneyInput
                  label="Buy price (cost)"
                  value={buyPrice}
                  onChange={setBuyPrice}
                  placeholder="0"
                />
              </View>
            ) : null}
            <View style={styles.flex}>
              <MoneyInput
                label="Sell price"
                value={sellPrice}
                onChange={setSellPrice}
                placeholder="0"
              />
            </View>
          </View>

          <MoneyInput
            label="Wholesale price (optional)"
            value={wholesalePrice}
            onChange={setWholesalePrice}
            placeholder="0"
          />

          {margin !== null ? (
            <AppText variant="label" muted>
              Unit profit: {formatTaka(margin, decimal)}
            </AppText>
          ) : null}
        </View>
      </SectionCard>

      <SectionCard title="Stock & warranty">
        <View style={styles.colGap}>
          {isEdit && existing ? (
            <View style={styles.stockBanner}>
              <View>
                <AppText variant="label" muted>
                  Current stock
                </AppText>
                <AppText variant="title">
                  {existing.stock} {existing.unit}
                </AppText>
              </View>
              {canAdjust ? (
                <Button
                  label="Adjust stock"
                  variant="yellow"
                  icon="tune"
                  onPress={() => setAdjustOpen(true)}
                />
              ) : null}
            </View>
          ) : (
            <TextField
              label="Opening stock"
              placeholder="0"
              keyboardType="decimal-pad"
              value={openingStock}
              onChangeText={(t) => {
                if (/^\d*\.?\d{0,3}$/.test(t)) setOpeningStock(t);
              }}
              helper="Initial quantity on hand"
            />
          )}

          <TextField
            label="Low-stock alert threshold"
            placeholder="0 (disabled)"
            keyboardType="decimal-pad"
            value={lowStockAlert}
            onChangeText={(t) => {
              if (/^\d*\.?\d{0,3}$/.test(t)) setLowStockAlert(t);
            }}
            helper="Warn when stock is at or below this quantity"
          />

          <View style={styles.catSection}>
            <AppText variant="secondary" muted>
              Warranty (days)
            </AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {WARRANTY_PRESETS.map((w) => (
                <Chip
                  key={w.label}
                  label={w.label}
                  selected={Number(warrantyDays || '0') === w.days}
                  onPress={() => setWarrantyDays(String(w.days))}
                />
              ))}
            </ScrollView>
            <TextField
              placeholder="0"
              keyboardType="number-pad"
              value={warrantyDays}
              onChangeText={(t) => {
                if (/^\d*$/.test(t)) setWarrantyDays(t);
              }}
            />
          </View>
        </View>
      </SectionCard>

      <SectionCard title="Online shop & notes">
        <View style={styles.colGap}>
          <SettingsRow
            icon="storefront-outline"
            label="Visible in Online Shop"
            kind="switch"
            value={onlineVisible}
            onValueChange={setOnlineVisible}
          />
          <SettingsRow
            icon="star-outline"
            label="Featured product"
            kind="switch"
            value={featured}
            onValueChange={setFeatured}
          />
          <TextField
            label="Description"
            placeholder="Details shown on online storefront or reference"
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </View>
      </SectionCard>

      <View style={styles.footerActions}>
        <Button
          label={isEdit ? 'Save changes' : 'Add product'}
          variant="primary"
          icon="check"
          fullWidth
          loading={saving}
          onPress={() => void handleSave()}
        />

        {isEdit && canDelete ? (
          <Button
            label="Delete product"
            variant="danger"
            icon="trash-can-outline"
            fullWidth
            onPress={() => setConfirmDelete(true)}
          />
        ) : null}
      </View>

      <BottomSheet
        visible={catSheetOpen}
        onClose={() => setCatSheetOpen(false)}
        title="New product category"
      >
        <TextField
          label="Category name"
          placeholder="e.g. Groceries, Electronics"
          value={newCatName}
          onChangeText={setNewCatName}
          autoFocus
        />
        <View style={styles.rowGap}>
          <Button
            label="Cancel"
            variant="outline"
            onPress={() => setCatSheetOpen(false)}
            style={styles.flex}
          />
          <Button label="Create" onPress={handleCreateCategory} style={styles.flex} />
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete product?"
        message="This product will be moved to the Recycle Bin. You can restore it later."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      {isEdit && existing ? (
        <AdjustStockSheet
          target={adjustOpen ? existing : null}
          ctx={ctx}
          onClose={() => setAdjustOpen(false)}
          onDone={onRefresh}
        />
      ) : null}
    </>
  );
}

export default function ProductFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const productId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;
  const isEdit = productId !== null;

  const { shopId, userId, role, shop } = useCurrentShop();
  const { rev, refresh } = useTableRevision(WATCHED_TABLES);

  const canManage = can(role, 'manageProducts');
  const canViewCost = can(role, 'viewCost');
  const canDelete = can(role, 'delete');
  const canAdjust = can(role, 'adjustStock');
  const decimal = shop?.decimal_enabled === 1;

  const existing = useMemo(() => {
    if (!shopId || !productId) return null;
    void rev;
    return getProductById(db, shopId, productId);
  }, [shopId, productId, rev]);

  const categories = useMemo(() => {
    if (!shopId) return [];
    void rev;
    return listProductCategories(db, shopId);
  }, [shopId, rev]);

  const ctx = useMemo<ServiceCtx | null>(
    () => (shopId && role ? { shopId, userId, role } : null),
    [shopId, userId, role],
  );

  const headerTitle = !isEdit ? 'Add product' : canManage ? 'Edit product' : 'Product details';
  const header = <AppHeader title={headerTitle} />;

  if (!shopId || !ctx) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading…" />
      </Screen>
    );
  }

  if (isEdit && !existing) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="package-variant-remove"
          title="Product not found"
          message="This product may have been deleted."
          action={{ label: 'Back to products', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  if (!isEdit && !canManage) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Restricted"
          message="Only owners and managers can add products."
        />
      </Screen>
    );
  }

  // Read-only detail view for cashiers (cost price strictly hidden)
  if (isEdit && existing && !canManage) {
    const stockTone =
      existing.stock <= 0 ? 'danger' : existing.isLowStock ? 'warning' : 'success';
    return (
      <Screen header={header}>
        <Card style={styles.viewHeader}>
          <ProductThumb uri={existing.image_uri} size={72} />
          <View style={styles.flex}>
            <AppText variant="title">{existing.name}</AppText>
            <AppText variant="secondary" muted>
              {[existing.categoryName, existing.code ? `#${existing.code}` : null]
                .filter(Boolean)
                .join(' · ') || `Unit: ${existing.unit}`}
            </AppText>
            <View style={styles.badgeRow}>
              <Badge label={`Stock: ${existing.stock} ${existing.unit}`} tone={stockTone} />
              {existing.online_visible === 1 ? <Badge label="Online" tone="neutral" /> : null}
            </View>
          </View>
        </Card>

        <SectionCard title="Pricing & Info">
          <View style={styles.kvRow}>
            <AppText muted>Sell price</AppText>
            <AppText bold>{formatTaka(existing.sell_price, decimal)}</AppText>
          </View>
          <Divider />
          <View style={styles.kvRow}>
            <AppText muted>Wholesale price</AppText>
            <AppText bold>{formatTaka(existing.wholesale_price, decimal)}</AppText>
          </View>
          <Divider />
          <View style={styles.kvRow}>
            <AppText muted>Warranty</AppText>
            <AppText bold>
              {existing.warranty_days > 0 ? `${existing.warranty_days} days` : 'None'}
            </AppText>
          </View>
          {existing.description ? (
            <>
              <Divider />
              <AppText variant="secondary" muted style={styles.desc}>
                {existing.description}
              </AppText>
            </>
          ) : null}
        </SectionCard>
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <ProductEditorBody
        key={existing?.id ?? 'new'}
        existing={existing}
        categories={categories}
        ctx={ctx}
        canViewCost={canViewCost}
        canDelete={canDelete}
        canAdjust={canAdjust}
        decimal={decimal}
        onRefresh={refresh}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  colGap: { gap: 12 },
  rowGap: { flexDirection: 'row', gap: 10 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoActions: { flex: 1, gap: 8 },
  catSection: { gap: 6 },
  chipRow: { gap: 8, paddingVertical: 2 },
  stockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  footerActions: { gap: 10, paddingBottom: 24 },
  viewHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  desc: { paddingTop: 8 },
});
