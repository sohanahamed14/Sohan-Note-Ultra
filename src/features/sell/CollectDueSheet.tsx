import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { METHODS, type Method, type Sale } from '@/db/schema';
import { now } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { formatMethodLabel } from '@/services/invoice';
import { collectSaleDue } from '@/services/sales';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import {
  AppText,
  BottomSheet,
  Button,
  ChipRow,
  DateField,
  MoneyInput,
  TextField,
  useToast,
} from '@/ui';

const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: formatMethodLabel(m) }));

type FormProps = {
  sale: Sale;
  customerName?: string | null;
  onClose: () => void;
  onCollected?: () => void;
};

function CollectDueForm({ sale, customerName, onClose, onCollected }: FormProps) {
  const { colors } = useTheme();
  const { shop, requireShop } = useCurrentShop();
  const toast = useToast();
  const dec = Boolean(shop?.decimal_enabled);

  const [amount, setAmount] = useState<number | null>(sale.due);
  const [method, setMethod] = useState<Method>('cash');
  const [date, setDate] = useState<number>(() => now());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const payPaisa = amount ?? 0;
  const overpaid = payPaisa > sale.due;
  const invalid = payPaisa <= 0 || overpaid;

  const handleSubmit = () => {
    if (invalid) return;
    try {
      setSaving(true);
      const ctx = requireShop();
      collectSaleDue(db, ctx, {
        saleId: sale.id,
        amount: payPaisa,
        method,
        date,
        note: note.trim() || null,
      });
      toast.show(`Collected ${formatTaka(payPaisa, dec)}`, 'success');
      onCollected?.();
      onClose();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={[styles.summary, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.summaryRow}>
          <AppText variant="secondary" muted>
            {sale.invoice_no}
            {customerName ? ` · ${customerName}` : ''}
          </AppText>
          <AppText bold style={{ color: colors.danger }}>
            Due: {formatTaka(sale.due, dec)}
          </AppText>
        </View>
      </View>

      <View style={styles.presets}>
        <Button
          label="Full Due"
          variant="outline"
          onPress={() => setAmount(sale.due)}
          style={styles.flex}
        />
        <Button
          label="Half"
          variant="outline"
          onPress={() => setAmount(Math.floor(sale.due / 2))}
          style={styles.flex}
        />
      </View>

      <MoneyInput
        label="Collection amount *"
        value={amount}
        onChange={setAmount}
        error={overpaid ? `Cannot exceed remaining due (${formatTaka(sale.due, dec)})` : undefined}
      />

      <View style={styles.block}>
        <AppText variant="secondary" muted>
          Payment method
        </AppText>
        <ChipRow options={METHOD_OPTIONS} value={method} onChange={setMethod} />
      </View>

      <DateField label="Date" value={date} onChange={setDate} />

      <TextField
        label="Note (optional)"
        placeholder="e.g. bKash TrxID"
        value={note}
        onChangeText={setNote}
      />

      <View style={styles.actions}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label="Collect"
          variant="primary"
          loading={saving}
          disabled={invalid}
          onPress={handleSubmit}
          style={styles.flex}
        />
      </View>
    </ScrollView>
  );
}

type Props = {
  sale: Sale | null;
  customerName?: string | null;
  onClose: () => void;
  onCollected?: () => void;
};

export function CollectDueSheet({ sale, customerName, onClose, onCollected }: Props) {
  return (
    <BottomSheet visible={Boolean(sale)} onClose={onClose} title="Collect Due">
      {sale ? (
        <CollectDueForm
          key={`${sale.id}-${sale.due}`}
          sale={sale}
          customerName={customerName}
          onClose={onClose}
          onCollected={onCollected}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 8 },
  summary: { padding: 12, borderRadius: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  presets: { flexDirection: 'row', gap: 8 },
  block: { gap: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
});
