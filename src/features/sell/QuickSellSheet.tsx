import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { METHODS, type Method, type Party } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { formatMethodLabel } from '@/services/invoice';
import { createQuickSale } from '@/services/sales';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { AppText, BottomSheet, Button, ChipRow, MoneyInput, TextField, useToast } from '@/ui';
import { CustomerPickerSheet } from './CustomerPickerSheet';

const METHOD_OPTIONS = METHODS.map((m) => ({ value: m, label: formatMethodLabel(m) }));

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (saleId: string) => void;
};

export function QuickSellSheet({ visible, onClose, onCreated }: Props) {
  const { colors } = useTheme();
  const { shop, requireShop } = useCurrentShop();
  const toast = useToast();
  const dec = Boolean(shop?.decimal_enabled);

  const [amount, setAmount] = useState<number | null>(null);
  const [paidOverride, setPaidOverride] = useState<number | null>(null);
  const [paidEdited, setPaidEdited] = useState(false);
  const [method, setMethod] = useState<Method>('cash');
  const [note, setNote] = useState('');
  const [party, setParty] = useState<Party | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const totalPaisa = amount ?? 0;
  const paidPaisa = paidEdited ? (paidOverride ?? 0) : totalPaisa;
  const duePaisa = Math.max(0, totalPaisa - paidPaisa);
  const overpaid = paidPaisa > totalPaisa;

  const reset = () => {
    setAmount(null);
    setPaidOverride(null);
    setPaidEdited(false);
    setMethod('cash');
    setNote('');
    setParty(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = () => {
    if (totalPaisa <= 0) {
      toast.show('Enter a sale amount greater than 0', 'error');
      return;
    }
    if (overpaid) {
      toast.show('Paid amount cannot exceed total', 'error');
      return;
    }
    if (duePaisa > 0 && !party) {
      toast.show('Select a customer for due sales', 'error');
      return;
    }
    try {
      setSaving(true);
      const ctx = requireShop();
      const created = createQuickSale(db, ctx, {
        amount: totalPaisa,
        paid: paidPaisa,
        partyId: party?.id ?? null,
        method,
        note: note.trim() || null,
      });
      toast.show(`Saved ${created.sale.invoice_no}`, 'success');
      reset();
      onClose();
      onCreated(created.sale.id);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BottomSheet visible={visible} onClose={handleClose} title="Quick Sell">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <MoneyInput
            label="Sale amount *"
            value={amount}
            onChange={(v) => {
              setAmount(v);
              if (!paidEdited) setPaidOverride(v);
            }}
            placeholder="0"
          />

          <MoneyInput
            label="Received amount"
            value={paidEdited ? paidOverride : amount}
            onChange={(v) => {
              setPaidEdited(true);
              setPaidOverride(v);
            }}
            error={overpaid ? 'Paid cannot exceed sale amount' : undefined}
            helper={
              duePaisa > 0
                ? `Due: ${formatTaka(duePaisa, dec)}${party ? '' : ' — select a customer below'}`
                : undefined
            }
          />

          <View style={styles.block}>
            <AppText variant="secondary" muted>
              Payment method
            </AppText>
            <ChipRow options={METHOD_OPTIONS} value={method} onChange={setMethod} />
          </View>

          <View style={styles.customerRow}>
            <View style={styles.flex}>
              <AppText variant="secondary" muted>
                Customer {duePaisa > 0 ? '*' : '(optional)'}
              </AppText>
              <AppText bold style={duePaisa > 0 && !party ? { color: colors.danger } : undefined}>
                {party ? `${party.name}${party.phone ? ` · ${party.phone}` : ''}` : 'Walk-in'}
              </AppText>
            </View>
            <Button
              label={party ? 'Change' : 'Select'}
              variant="outline"
              onPress={() => setPickerOpen(true)}
            />
          </View>

          <TextField
            label="Item / Note (optional)"
            placeholder="e.g. Service charge, misc items"
            value={note}
            onChangeText={setNote}
          />

          <View style={styles.actions}>
            <Button label="Cancel" variant="outline" onPress={handleClose} style={styles.flex} />
            <Button
              label={totalPaisa > 0 ? `Save · ${formatTaka(totalPaisa, dec)}` : 'Save Sale'}
              variant="yellow"
              loading={saving}
              disabled={totalPaisa <= 0 || overpaid}
              onPress={handleSave}
              style={styles.flex}
            />
          </View>
        </ScrollView>
      </BottomSheet>

      <CustomerPickerSheet
        visible={pickerOpen}
        selectedId={party?.id ?? null}
        onSelect={setParty}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 8 },
  block: { gap: 4 },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
});
