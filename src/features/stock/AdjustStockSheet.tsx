import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { now } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { roundQty } from '@/lib/money';
import { adjustStock, type ServiceCtx } from '@/services/stock';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppText,
  BottomSheet,
  Button,
  Chip,
  DateField,
  QtyStepper,
  Segmented,
  TextField,
  useToast,
} from '@/ui';

type AdjustTarget = {
  id: string;
  name: string;
  unit: string;
  stock: number;
};

type Mode = 'add' | 'remove' | 'set';

const QUICK_REASONS = ['Count fix', 'Damaged', 'Return', 'Loss'] as const;

function AdjustStockForm({
  target,
  ctx,
  onClose,
  onDone,
}: {
  target: AdjustTarget;
  ctx: ServiceCtx | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('add');
  const [qty, setQty] = useState(1);
  const [date, setDate] = useState(() => now());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const previewNew =
    mode === 'add'
      ? roundQty(target.stock + qty)
      : mode === 'remove'
        ? roundQty(target.stock - qty)
        : roundQty(qty);
  const invalidRemove = mode === 'remove' && previewNew < 0;
  const noChange = previewNew === target.stock;

  const handleSave = () => {
    if (!ctx) return;
    setSaving(true);
    try {
      const res = adjustStock(db, ctx, {
        productId: target.id,
        mode: mode === 'set' ? 'set' : 'delta',
        qty: mode === 'remove' ? -qty : qty,
        date,
        note: note.trim() || undefined,
      });
      toast.show(`Stock updated to ${res.newStock} ${target.unit}`, 'success');
      onDone();
      onClose();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <View style={[styles.preview, { backgroundColor: colors.surfaceMuted }]}>
        <View>
          <AppText variant="label" muted>
            Current stock
          </AppText>
          <AppText bold>
            {target.stock} {target.unit}
          </AppText>
        </View>
        <AppText bold muted>
          →
        </AppText>
        <View style={styles.rightCol}>
          <AppText variant="label" muted>
            New stock
          </AppText>
          <AppText
            bold
            style={{
              color: invalidRemove
                ? colors.danger
                : previewNew > target.stock
                  ? colors.success
                  : colors.text,
            }}
          >
            {previewNew} {target.unit}
          </AppText>
        </View>
      </View>

      <Segmented<Mode>
        value={mode}
        onChange={(m) => {
          setMode(m);
          setQty(m === 'set' ? Math.max(0, target.stock) : 1);
        }}
        options={[
          { value: 'add', label: 'Add (+)' },
          { value: 'remove', label: 'Remove (-)' },
          { value: 'set', label: 'Set exact' },
        ]}
      />

      <View style={styles.qtyRow}>
        <AppText variant="secondary" muted>
          {mode === 'set' ? `Target (${target.unit})` : `Quantity (${target.unit})`}
        </AppText>
        <QtyStepper value={qty} onChange={setQty} min={0} step={1} />
      </View>

      {invalidRemove ? (
        <AppText variant="label" style={{ color: colors.danger }}>
          Cannot remove more than available stock ({target.stock} {target.unit}).
        </AppText>
      ) : null}

      <DateField label="Date" value={date} onChange={setDate} />

      <View style={styles.reasonWrap}>
        <AppText variant="label" muted>
          Quick reason
        </AppText>
        <View style={styles.chips}>
          {QUICK_REASONS.map((r) => (
            <Chip key={r} label={r} selected={note === r} onPress={() => setNote(r)} />
          ))}
        </View>
      </View>

      <TextField
        label="Note (optional)"
        placeholder="e.g. Damaged pack, physical audit"
        value={note}
        onChangeText={setNote}
      />

      <View style={styles.actions}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label="Save adjustment"
          onPress={handleSave}
          loading={saving}
          disabled={invalidRemove || noChange}
          style={styles.flex}
        />
      </View>
    </ScrollView>
  );
}

export function AdjustStockSheet({
  target,
  ctx,
  onClose,
  onDone,
}: {
  target: AdjustTarget | null;
  ctx: ServiceCtx | null;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!target) return null;

  return (
    <BottomSheet visible={true} onClose={onClose} title={`Adjust stock — ${target.name}`}>
      <AdjustStockForm
        key={`${target.id}-${target.stock}`}
        target={target}
        ctx={ctx}
        onClose={onClose}
        onDone={onDone}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingBottom: 12 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: radius.card,
  },
  rightCol: { alignItems: 'flex-end' },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  reasonWrap: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
