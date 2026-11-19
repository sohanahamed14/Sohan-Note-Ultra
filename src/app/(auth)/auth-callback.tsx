import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { completeAuthFromUrl, syncExistingSupabaseSession } from '@/auth';
import { db } from '@/db/client';
import { errorMessage } from '@/lib/errors';
import { AppHeader, Button, EmptyState, Loading, Screen } from '@/ui';

export default function AuthCallbackScreen() {
  const url = Linking.useURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (url) {
          const ok = await completeAuthFromUrl(db, url);
          if (ok && active) {
            router.replace('/');
            return;
          }
        }
        const existing = await syncExistingSupabaseSession(db);
        if (active) {
          router.replace(existing ? '/' : '/(auth)/login');
        }
      } catch (e) {
        if (active) setError(errorMessage(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [url]);

  if (error) {
    return (
      <Screen header={<AppHeader title="Sign in" back={false} />} scroll={false}>
        <View style={styles.wrap}>
          <EmptyState icon="alert-circle-outline" title="Sign-in failed" message={error} />
          <Button label="Back to login" onPress={() => router.replace('/(auth)/login')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Loading label="Completing sign-in…" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', gap: 12 },
});
