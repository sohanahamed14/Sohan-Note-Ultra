import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorMessage } from '@/lib/errors';
import {
  authenticateBiometric,
  changePin,
  disableAppLock,
  setPin,
  verifyPin,
} from '@/services/applock';
import { useTheme } from '@/theme';
import { AppText, BottomSheet, Button, TextField, useToast } from '@/ui';

export type AppLockModalMode = 'setup' | 'disable' | 'change' | 'verify';

function AppLockBody({
  mode,
  allowBiometric,
  onClose,
  onSuccess,
}: {
  mode: AppLockModalMode;
  allowBiometric: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'setup') {
        if (newPin !== confirmPin) {
          setError('PINs do not match');
          return;
        }
        await setPin(newPin);
        toast.show('App Lock enabled', 'success');
      } else if (mode === 'change') {
        if (newPin !== confirmPin) {
          setError('New PINs do not match');
          return;
        }
        await changePin(currentPin, newPin);
        toast.show('PIN updated', 'success');
      } else if (mode === 'disable') {
        await disableAppLock(currentPin);
        toast.show('App Lock disabled', 'info');
      } else {
        const ok = await verifyPin(currentPin);
        if (!ok) {
          setError('Incorrect PIN');
          return;
        }
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleBiometric = async () => {
    const ok = await authenticateBiometric();
    if (ok) {
      onSuccess();
      onClose();
    } else {
      setError('Biometric authentication failed');
    }
  };

  const numericOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  return (
    <View style={styles.body}>
      {mode === 'disable' || mode === 'change' || mode === 'verify' ? (
        <TextField
          label={mode === 'verify' ? 'Enter PIN' : 'Current PIN'}
          value={currentPin}
          onChangeText={(t) => setCurrentPin(numericOnly(t))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          placeholder="4-6 digits"
        />
      ) : null}

      {mode === 'setup' || mode === 'change' ? (
        <>
          <TextField
            label={mode === 'change' ? 'New PIN (4-6 digits)' : 'PIN (4-6 digits)'}
            value={newPin}
            onChangeText={(t) => setNewPin(numericOnly(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            placeholder="Enter 4-6 digits"
          />
          <TextField
            label="Confirm PIN"
            value={confirmPin}
            onChangeText={(t) => setConfirmPin(numericOnly(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            placeholder="Re-enter PIN"
          />
        </>
      ) : null}

      {error ? (
        <AppText variant="secondary" style={{ color: colors.danger }}>
          {error}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label={mode === 'disable' ? 'Disable' : mode === 'verify' ? 'Unlock' : 'Save PIN'}
          variant={mode === 'disable' ? 'danger' : 'primary'}
          loading={busy}
          onPress={handleSubmit}
          style={styles.flex}
        />
      </View>

      {mode === 'verify' && allowBiometric ? (
        <Button
          label="Use Biometrics"
          variant="ghost"
          icon="fingerprint"
          onPress={handleBiometric}
          fullWidth
        />
      ) : null}
    </View>
  );
}

export function AppLockModal({
  visible,
  mode,
  allowBiometric = false,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  mode: AppLockModalMode;
  allowBiometric?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const title =
    mode === 'setup'
      ? 'Set App Lock PIN'
      : mode === 'change'
        ? 'Change App Lock PIN'
        : mode === 'disable'
          ? 'Turn off App Lock'
          : 'Unlock App';

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {visible ? (
        <AppLockBody
          key={mode}
          mode={mode}
          allowBiometric={allowBiometric}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
