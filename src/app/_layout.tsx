import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { expoDb } from '@/db/client';
import migrations from '../../drizzle/migrations';
import { useSession } from '@/store/session';
import { DEV_LOGIN, ensureDevSession } from '@/store/devLogin';
import { ThemeProvider, useTheme } from '@/theme';
import { AppText, Loading, ToastProvider } from '@/ui';

void SplashScreen.preventAutoHideAsync();

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

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (ready && DEV_LOGIN) ensureDevSession();
  }, [ready]);

  useEffect(() => {
    if (!ready || root === 's') return;
    const inAuth = root === '(auth)';
    if (!user) {
      if (!DEV_LOGIN && !(inAuth && parts[1] === 'login')) router.replace('/(auth)/login');
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
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

export default function RootLayout() {
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
