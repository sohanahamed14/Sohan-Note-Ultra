import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { db } from '@/db/client';
import { METHODS, type Method } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { METHOD_LABELS } from '@/services/cash';
import { collectDue, payDue, recordGive, recordTake } from '@/services/ledger';
import type { PartyWithBalance } from '@/services/parties';
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

type Props = {
  visible: boolean;
  mode: 'give' | 'take';
  party: PartyWithBalance;
  decimal: boolean;
  onClose: () => void;
  onSaved: () => void;
};

function LedgerEntryBody({ mode, party, decimal, onClose, onSaved }: Omit<Props, 'visible'>) {
  const { colors } = useTheme();
  const { requireShop } = useCurrentShop();
  const toast = useToast();

  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [date, setDate] = useState<number>(() => Date.now());
  const [note, setNote] = useState('');
  const [affectCash, setAffectCash] = useState(true);
  const [amountError, setAmountError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const isTake = mode === 'take';
  const settleable = isTake
    ? party.balance > 0
      ? party.balance
      : 0
    : party.balance < 0
      ? -party.balance
      : 0;
  const exceedsDue = settleable > 0 && amount !== null && amount > settleable;

  const handleSave = () => {
    if (!amount || amount <= 0) {
      setAmountError('Enter an amount greater than 0');
      return;
    }
    setAmountError(undefined);
    setSaving(true);
    try {
      const ctx = requireShop();
      if (isTake) {
        if (affectCash && party.balance > 0 && amount <= party.balance) {
          collectDue(db, ctx, { partyId: party.id, amount, method, date, note });
        } else {
          recordTake(db, ctx, { partyId: party.id, amount, method, date, note, affectCash });
        }
        toast.show(`Recorded ${formatTaka(amount, decimal)} received`, 'success');
      } else {
        if (affectCash && party.balance < 0 && amount <= -party.balance) {
          payDue(db, ctx, { partyId: party.id, amount, method, date, note });
        } else {
          recordGive(db, ctx, { partyId: party.id, amount, method, date, note, affectCash });
        }
        toast.show(`Recorded ${formatTaka(amount, decimal)} given`, 'success');
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
          exceedsDue
            ? `Exceeds current due by ${formatTaka((amount ?? 0) - settleable, decimal)} — excess will carry forward`
            : undefined
        }
      />

      {settleable > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setAmount(settleable);
            setAmountError(undefined);
          }}
          style={[styles.quickFill, { backgroundColor: colors.primarySoft }]}
        >
          <AppText variant="secondary" bold style={{ color: colors.text }}>
            Fill full due: {formatTaka(settleable, decimal)}
          </AppText>
        </Pressable>
      ) : null}

      <View
        style={[
          styles.switchRow,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
        ]}
      >
        <View style={styles.flex}>
          <AppText variant="secondary" bold>
            Record in Cashbox
          </AppText>
          <AppText variant="label" muted>
            {isTake ? 'Adds cash inflow to Cashbox' : 'Deducts cash outflow from Cashbox'}
          </AppText>
        </View>
        <Switch
          value={affectCash}
          onValueChange={setAffectCash}
          trackColor={{ true: colors.accent }}
        />
      </View>

      {affectCash ? (
        <View style={styles.field}>
          <AppText variant="secondary" muted>
            Payment method
          </AppText>
          <ChipRow options={METHOD_OPTIONS} value={method} onChange={setMethod} />
        </View>
      ) : null}

      <DateField label="Date" value={date} onChange={setDate} />

      <TextField
        label="Note"
        value={note}
        onChangeText={setNote}
        placeholder="Optional reference or note"
      />

      <View style={styles.actions}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label={isTake ? 'Save Received' : 'Save Given'}
          variant={isTake ? 'primary' : 'danger'}
          onPress={handleSave}
          loading={saving}
          style={styles.flex}
        />
      </View>
    </ScrollView>
  );
}

export function LedgerEntrySheet({ visible, mode, party, decimal, onClose, onSaved }: Props) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'take' ? `You Got from ${party.name}` : `You Gave to ${party.name}`}
    >
      {visible ? (
        <LedgerEntryBody
          key={`${party.id}-${mode}`}
          mode={mode}
          party={party}
          decimal={decimal}
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
