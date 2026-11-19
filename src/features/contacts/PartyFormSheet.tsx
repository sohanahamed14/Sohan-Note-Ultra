import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { errorMessage } from '@/lib/errors';
import {
  createParty,
  deleteParty,
  updateParty,
  type PartyType,
  type PartyWithBalance,
} from '@/services/parties';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import {
  AppText,
  BottomSheet,
  Button,
  ConfirmDialog,
  MoneyInput,
  Segmented,
  TextField,
  useToast,
} from '@/ui';

const TYPE_OPTIONS: { value: PartyType; label: string }[] = [
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'employee', label: 'Employee' },
];

type OpeningDir = 'receivable' | 'payable';

const OPENING_DIRS: { value: OpeningDir; label: string }[] = [
  { value: 'receivable', label: 'They owe me' },
  { value: 'payable', label: 'I owe them' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  defaultType?: PartyType;
  party?: PartyWithBalance | null;
  onSaved: (party: PartyWithBalance) => void;
  onDeleted?: () => void;
};

function PartyFormBody({
  onClose,
  defaultType,
  party,
  onSaved,
  onRequestDelete,
}: {
  onClose: () => void;
  defaultType: PartyType;
  party: PartyWithBalance | null;
  onSaved: (party: PartyWithBalance) => void;
  onRequestDelete: () => void;
}) {
  const { requireShop, role } = useCurrentShop();
  const toast = useToast();

  const initialType = party?.type ?? defaultType;
  const [type, setType] = useState<PartyType>(initialType);
  const [name, setName] = useState(party?.name ?? '');
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [note, setNote] = useState(party?.note ?? '');
  const [openingAmt, setOpeningAmt] = useState<number | null>(null);
  const [openingDir, setOpeningDir] = useState<OpeningDir>(
    initialType === 'supplier' ? 'payable' : 'receivable',
  );
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    setNameError(undefined);
    setSaving(true);
    try {
      const ctx = requireShop();
      let saved: PartyWithBalance;
      if (party) {
        saved = updateParty(db, ctx, party.id, {
          type,
          name,
          phone,
          address,
          note,
        });
        toast.show('Contact updated', 'success');
      } else {
        const signedOpening =
          openingAmt && openingAmt > 0
            ? openingDir === 'receivable'
              ? openingAmt
              : -openingAmt
            : 0;
        saved = createParty(db, ctx, {
          type,
          name,
          phone,
          address,
          note,
          openingBalance: signedOpening,
        });
        toast.show('Contact added', 'success');
      }
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
      <View style={styles.section}>
        <AppText variant="secondary" muted>
          Contact type
        </AppText>
        <Segmented
          options={TYPE_OPTIONS}
          value={type}
          onChange={(v) => {
            setType(v);
            if (!party) setOpeningDir(v === 'supplier' ? 'payable' : 'receivable');
          }}
        />
      </View>

      <TextField
        label="Name *"
        value={name}
        onChangeText={(t) => {
          setName(t);
          if (nameError) setNameError(undefined);
        }}
        placeholder="Full name or business name"
        error={nameError}
        autoCapitalize="words"
      />

      <TextField
        label="Phone"
        value={phone}
        onChangeText={setPhone}
        placeholder="01XXXXXXXXX"
        keyboardType="phone-pad"
      />

      <TextField
        label="Address"
        value={address}
        onChangeText={setAddress}
        placeholder="Area, road, market"
      />

      <TextField
        label="Note"
        value={note}
        onChangeText={setNote}
        placeholder="Optional note"
        multiline
      />

      {!party ? (
        <View style={styles.section}>
          <MoneyInput
            label="Opening due balance (optional)"
            value={openingAmt}
            onChange={setOpeningAmt}
            placeholder="0"
          />
          {openingAmt && openingAmt > 0 ? (
            <Segmented options={OPENING_DIRS} value={openingDir} onChange={setOpeningDir} />
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label={party ? 'Update' : 'Save Contact'}
          onPress={handleSave}
          loading={saving}
          style={styles.flex}
        />
      </View>

      {party && can(role, 'delete') ? (
        <Button
          label="Delete Contact"
          variant="ghost"
          icon="trash-can-outline"
          onPress={onRequestDelete}
          fullWidth
        />
      ) : null}
    </ScrollView>
  );
}

export function PartyFormSheet({
  visible,
  onClose,
  defaultType = 'customer',
  party = null,
  onSaved,
  onDeleted,
}: Props) {
  const { requireShop } = useCurrentShop();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (!party) return;
    try {
      const ctx = requireShop();
      deleteParty(db, ctx, party.id);
      toast.show('Contact moved to recycle bin', 'success');
      setConfirmDelete(false);
      onClose();
      onDeleted?.();
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
        title={party ? 'Edit Contact' : 'New Contact'}
      >
        {visible ? (
          <PartyFormBody
            key={party?.id ?? `new-${defaultType}`}
            onClose={onClose}
            defaultType={defaultType}
            party={party}
            onSaved={onSaved}
            onRequestDelete={() => setConfirmDelete(true)}
          />
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete contact?"
        message="This contact will be moved to the recycle bin. Contacts with unpaid dues must be settled first."
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
  section: { gap: 6 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
