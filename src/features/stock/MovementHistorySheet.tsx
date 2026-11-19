import { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { StockMovement } from '@/db/schema';
import { formatDateTime } from '@/lib/date';
import { listStockMovements, type StockMovementWithProduct } from '@/services/stock';
import { useTheme } from '@/theme';
import { AppText, Badge, BottomSheet, Button, EmptyState, ListRow } from '@/ui';

type HistoryTarget = {
  id: string;
  name: string;
  unit: string;
  stock: number;
};

const TYPE_META: Record<
  StockMovement['type'],
  { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }
> = {
  opening: { label: 'Opening', tone: 'neutral' },
  purchase: { label: 'Purchase', tone: 'success' },
  sale: { label: 'Sale', tone: 'danger' },
  adjust: { label: 'Adjust', tone: 'warning' },
  restore: { label: 'Restore', tone: 'neutral' },
};

export function MovementHistorySheet({
  target,
  shopId,
  rev,
  canAdjust,
  onClose,
  onAdjust,
}: {
  target: HistoryTarget | null;
  shopId: string | null;
  rev: number;
  canAdjust: boolean;
  onClose: () => void;
  onAdjust?: () => void;
}) {
  const { colors } = useTheme();

  const movements = useMemo<StockMovementWithProduct[]>(() => {
    if (!target || !shopId) return [];
    void rev;
    return listStockMovements(db, shopId, { productId: target.id });
  }, [target, shopId, rev]);

  if (!target) return null;

  return (
    <BottomSheet visible={!!target} onClose={onClose} title={target.name}>
      <View style={styles.topRow}>
        <AppText variant="secondary" muted>
          Current stock:{' '}
          <AppText bold>
            {target.stock} {target.unit}
          </AppText>
        </AppText>
        {canAdjust && onAdjust ? (
          <Button label="Adjust" variant="yellow" icon="tune" onPress={onAdjust} />
        ) : null}
      </View>

      <View style={styles.listWrap}>
        <FlatList
          data={movements}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <EmptyState
              icon="history"
              title="No stock movements yet"
              message="Stock changes from opening stock, purchases, sales, and adjustments appear here."
            />
          }
          renderItem={({ item }) => {
            const meta = TYPE_META[item.type];
            const positive = item.qty >= 0;
            const sign = positive ? '+' : '';
            return (
              <ListRow
                title={item.note ?? meta.label}
                subtitle={formatDateTime(item.date)}
                left={<Badge label={meta.label} tone={meta.tone} />}
                right={
                  <AppText
                    bold
                    style={{ color: positive ? colors.success : colors.danger }}
                  >
                    {sign}
                    {item.qty} {item.productUnit}
                  </AppText>
                }
              />
            );
          }}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  listWrap: { maxHeight: 380, minHeight: 160 },
});
