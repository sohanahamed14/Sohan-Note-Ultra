import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { expoDb, initDb } from '@/db/client';
import migrations from '../../drizzle/migrations';
import {
  authenticateBiometric,
  getAppLockState,
  verifyPin,
} from '@/services/applock';
import { useSession } from '@/store/session';
import { useSyncLifecycle } from '@/sync/manager';
import { DEV_LOGIN, ensureDevSession } from '@/store/devLogin';
import { ThemeProvider, useTheme } from '@/theme';
import { AppText, Button, Card, Loading, TextField, ToastProvider } from '@/ui';

void SplashScreen.preventAutoHideAsync();

function SyncRuntime() {
  useSyncLifecycle();
  return null;
}

function AppLockOverlay({
  biometric,
  onUnlocked,
}: {
  biometric: boolean;
  onUnlocked: () => void;
}) {
  const { colors } = useTheme();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleVerify = async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await verifyPin(pin);
      if (ok) {
        setPin('');
        onUnlocked();
      } else {
        setError('Incorrect PIN');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBio = async () => {
    const ok = await authenticateBiometric();
    if (ok) onUnlocked();
    else setError('Biometric unlock failed');
  };

  return (
    <View style={[styles.lockScreen, { backgroundColor: colors.bg }]}>
      <Card style={styles.lockCard}>
        <View style={[styles.lockIcon, { backgroundColor: colors.primary }]}>
          <MaterialCommunityIcons name="lock-outline" size={32} color={colors.onPrimary} />
        </View>
        <AppText variant="title" style={styles.center}>
          Sohan Note Ultra Locked
        </AppText>
        <AppText variant="secondary" muted style={styles.center}>
          Enter your PIN to continue
        </AppText>
        <TextField
          label="PIN"
          value={pin}
          onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          placeholder="Enter 4-6 digit PIN"
        />
        {error ? (
          <AppText variant="secondary" style={{ color: colors.danger }}>
            {error}
          </AppText>
        ) : null}
        <Button label="Unlock" loading={busy} onPress={handleVerify} fullWidth />
        {biometric ? (
          <Button
            label="Use Biometrics"
            variant="outline"
            icon="fingerprint"
            onPress={handleBio}
            fullWidth
          />
        ) : null}
      </Card>
    </View>
  );
}

function Gate() {
  const { scheme } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const { success, error } = useMigrations(expoDb, migrations);
  const hydrated = useSession((s) => s.hydrated);
  const user = useSession((s) => s.user);
  const shopId = useSession((s) => s.shopId);
  const ready = success && hydrated;
  const parts: string[] = segments;
  const root = parts[0];
  const [locked, setLocked] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const prevState = useRef(AppState.currentState);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (ready && DEV_LOGIN) ensureDevSession();
  }, [ready]);

  useEffect(() => {
    if (!ready || !user || root === 's') return;
    const check = () => {
      void getAppLockState()
        .then((s) => {
          setBioEnabled(s.biometricEnabled);
          setLocked(s.enabled);
        })
        .catch(() => undefined);
    };
    check();
    const sub = AppState.addEventListener('change', (next) => {
      if (prevState.current === 'background' && next === 'active') check();
      prevState.current = next;
    });
    return () => sub.remove();
  }, [ready, user, root]);

  useEffect(() => {
    if (!ready || root === 's') return;
    const inAuth = root === '(auth)';
    if (!user) {
      const allowedAuth = inAuth && (parts[1] === 'login' || parts[1] === 'auth-callback');
      if (!DEV_LOGIN && !allowedAuth) router.replace('/(auth)/login');
    } else if (!shopId) {
      if (!(inAuth && parts[1] === 'create-shop')) router.replace('/(auth)/create-shop');
    } else if (inAuth) {
      router.replace('/');
    }
  }, [ready, user, shopId, root, parts, router]);

  if (error) {
    return <AppText style={{ padding: 24 }}>Database error: {error.message}</AppText>;
  }
  if (!ready) return <Loading label="Loading…" />;
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SyncRuntime />
      <Stack screenOptions={{ headerShown: false }} />
      {locked && Boolean(user) && root !== 's' ? (
        <AppLockOverlay biometric={bioEnabled} onUnlocked={() => setLocked(false)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  lockScreen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  lockCard: { width: '100%', maxWidth: 380, padding: 20, gap: 12 },
  lockIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  center: { textAlign: 'center' },
});

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    initDb().then(
      () => setDbReady(true),
      (e: unknown) => setDbError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  if (dbError) return <Text style={{ padding: 24 }}>Database error: {dbError}</Text>;
  if (!dbReady) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
