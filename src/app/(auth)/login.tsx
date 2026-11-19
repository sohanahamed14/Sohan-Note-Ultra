import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  completeAuthFromUrl,
  completeSignIn,
  extractSessionUser,
  signInWithEmailDev,
  signInWithGoogle,
  syncExistingSupabaseSession,
} from '@/auth';
import { db } from '@/db/client';
import { errorMessage } from '@/lib/errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEV_LOGIN, ensureDevSession } from '@/store/devLogin';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText, Button, Card, Screen, TextField, useToast } from '@/ui';

export default function LoginScreen() {
  const { colors } = useTheme();
  const toast = useToast();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const incomingUrl = Linking.useURL();

  useEffect(() => {
    if (!incomingUrl || !incomingUrl.includes('auth-callback')) return;
    void completeAuthFromUrl(db, incomingUrl).catch((e) => setError(errorMessage(e)));
  }, [incomingUrl]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await syncExistingSupabaseSession(db);
      } catch (e) {
        if (mounted) setError(errorMessage(e));
      } finally {
        if (mounted) setCheckingSession(false);
      }
    })();

    if (!isSupabaseConfigured) return () => { mounted = false; };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        void completeSignIn(db, extractSessionUser(session.user)).catch((e) => {
          if (mounted) setError(errorMessage(e));
        });
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle(db);
      if (res.completed) {
        toast.show('Signed in with Google', 'success');
      }
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast.show(msg, 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDevEmailLogin = async () => {
    setError(null);
    setDevLoading(true);
    try {
      await signInWithEmailDev(db, email, password);
      toast.show('Signed in', 'success');
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast.show(msg, 'error');
    } finally {
      setDevLoading(false);
    }
  };

  const handleLocalDevOwner = () => {
    setError(null);
    ensureDevSession();
    toast.show('Signed in as Dev Owner', 'success');
  };

  return (
    <Screen padded={false}>
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <View style={[styles.brandBadge, { backgroundColor: colors.onPrimary }]}>
          <MaterialCommunityIcons name="notebook-edit-outline" size={44} color={colors.primary} />
        </View>
        <AppText style={[styles.brandTitle, { color: colors.onPrimary }]}>
          Sohan Note Ultra
        </AppText>
        <AppText variant="secondary" style={[styles.tagline, { color: colors.onPrimary }]}>
          Smart bookkeeping, POS & online store for your business
        </AppText>
      </View>

      <View style={styles.body}>
        <Card style={styles.card}>
          <AppText variant="title">Sign in to continue</AppText>
          <AppText variant="secondary" muted>
            Your accounts, stock, and invoices stay synced safely across devices and work offline
            anytime.
          </AppText>

          {error ? (
            <View style={[styles.errorBox, { backgroundColor: colors.danger + '18' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.danger} />
              <AppText variant="secondary" style={[styles.flex, { color: colors.danger }]}>
                {error}
              </AppText>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={googleLoading || checkingSession}
            onPress={handleGoogleLogin}
            style={[
              styles.googleBtn,
              {
                backgroundColor: colors.accent,
                opacity: googleLoading || checkingSession ? 0.7 : 1,
              },
            ]}
          >
            <MaterialCommunityIcons name="google" size={22} color="#FFFFFF" />
            <AppText bold style={styles.googleText}>
              {googleLoading
                ? 'Signing in…'
                : checkingSession
                  ? 'Checking session…'
                  : 'Continue with Google'}
            </AppText>
          </Pressable>

          {!isSupabaseConfigured ? (
            <AppText variant="label" muted style={styles.center}>
              Cloud sign-in requires EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY.
            </AppText>
          ) : null}

          <View style={styles.highlights}>
            {[
              { icon: 'cloud-check-outline' as const, text: 'Automatic cloud backup & sync' },
              { icon: 'account-group-outline' as const, text: 'Team roles for owner, manager & cashier' },
              { icon: 'storefront-outline' as const, text: 'Instant online storefront & PDF invoices' },
            ].map((item) => (
              <View key={item.text} style={styles.highlightRow}>
                <MaterialCommunityIcons name={item.icon} size={18} color={colors.accent} />
                <AppText variant="secondary" muted style={styles.flex}>
                  {item.text}
                </AppText>
              </View>
            ))}
          </View>
        </Card>

        {DEV_LOGIN ? (
          <Card style={styles.card}>
            <AppText bold>Developer Login (EXPO_PUBLIC_DEV_LOGIN=1)</AppText>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="dev@example.com"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
            />
            <Button
              label="Sign in with Email"
              loading={devLoading}
              onPress={handleDevEmailLogin}
              fullWidth
            />
            <Button
              label="Quick Local Dev Owner"
              variant="yellow"
              icon="flash-outline"
              onPress={handleLocalDevOwner}
              fullWidth
            />
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingTop: 64,
    paddingBottom: 36,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  brandBadge: {
    width: 76,
    height: 76,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: { fontSize: 26, fontWeight: '800', marginTop: 4 },
  tagline: { textAlign: 'center', opacity: 0.85, maxWidth: 320 },
  body: { padding: 16, gap: 16 },
  card: { padding: 18, gap: 14 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radius.row,
  },
  googleBtn: {
    minHeight: 50,
    borderRadius: radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  googleText: { color: '#FFFFFF', fontSize: 16 },
  highlights: { gap: 8, paddingTop: 4 },
  highlightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
});
