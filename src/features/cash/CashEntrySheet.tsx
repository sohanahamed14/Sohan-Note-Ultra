import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { METHODS, type Method } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { investCapital, withdrawCapital } from '@/services/capital';
import { addManualCash, METHOD_LABELS } from '@/services/cash';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
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

const METHOD_OPTIONS: { value: Method; label: string }[] = METHODS.map((m) => ({
  value: m,
  label: METHOD_LABELS[m],
}));

export type CashSheetKind = 'cash_in' | 'cash_out' | 'capital_in' | 'capital_out';

const META: Record<CashSheetKind, { title: string; cta: string; danger: boolean }> = {
  cash_in: { title: 'Cash In', cta: 'Save Cash In', danger: false },
  cash_out: { title: 'Cash Out', cta: 'Save Cash Out', danger: true },
  capital_in: { title: 'Invest Capital', cta: 'Add Investment', danger: false },
  capital_out: { title: 'Withdraw Capital', cta: 'Withdraw', danger: true },
};

type Props = {
  visible: boolean;
  kind: CashSheetKind;
  decimal: boolean;
  availableCapital?: number;
  onClose: () => void;
  onSaved: () => void;
};

function CashEntryBody({
  kind,
  decimal,
  availableCapital,
  onClose,
  onSaved,
}: Omit<Props, 'visible'> & { availableCapital: number }) {
  const { colors } = useTheme();
  const { requireShop } = useCurrentShop();
  const toast = useToast();

  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [date, setDate] = useState<number>(() => Date.now());
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const meta = META[kind];

  const handleSave = () => {
    if (!amount || amount <= 0) {
      setAmountError('Enter an amount greater than 0');
      return;
    }
    setAmountError(undefined);
    setSaving(true);
    try {
      const ctx = requireShop();
      if (kind === 'cash_in') {
        addManualCash(db, ctx, { direction: 'in', amount, method, date, note });
        toast.show(`Added ${formatTaka(amount, decimal)} to Cashbox`, 'success');
      } else if (kind === 'cash_out') {
        addManualCash(db, ctx, { direction: 'out', amount, method, date, note });
        toast.show(`Recorded ${formatTaka(amount, decimal)} cash out`, 'success');
      } else if (kind === 'capital_in') {
        investCapital(db, ctx, { amount, method, date, note });
        toast.show(`Invested ${formatTaka(amount, decimal)} capital`, 'success');
      } else {
        withdrawCapital(db, ctx, { amount, method, date, note });
        toast.show(`Withdrew ${formatTaka(amount, decimal)} capital`, 'success');
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
        helper={
          kind === 'capital_out'
            ? `Available capital: ${formatTaka(availableCapital, decimal)}`
            : undefined
        }
      />

      {kind === 'capital_out' && availableCapital > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setAmount(availableCapital);
            setAmountError(undefined);
          }}
          style={[styles.quickFill, { backgroundColor: colors.primarySoft }]}
        >
          <AppText variant="secondary" bold>
            Withdraw all: {formatTaka(availableCapital, decimal)}
          </AppText>
        </Pressable>
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
        placeholder="Optional note or source"
      />

      <View style={styles.actions}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label={meta.cta}
          variant={meta.danger ? 'danger' : 'primary'}
          onPress={handleSave}
          loading={saving}
          style={styles.flex}
        />
      </View>
    </ScrollView>
  );
}

export function CashEntrySheet({
  visible,
  kind,
  decimal,
  availableCapital = 0,
  onClose,
  onSaved,
}: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={META[kind].title}>
      {visible ? (
        <CashEntryBody
          key={kind}
          kind={kind}
          decimal={decimal}
          availableCapital={availableCapital}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, paddingBottom: 16 },
  field: { gap: 4 },
  quickFill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
