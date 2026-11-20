import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, View } from 'react-native';
import { hydrateUserShops, signOutAll } from '@/auth';
import { db } from '@/db/client';
import { AppLockModal, type AppLockModalMode } from '@/features/settings/AppLockModal';
import { CategoriesSheet } from '@/features/settings/CategoriesSheet';
import { shareShopDataJson } from '@/features/settings/dataTransfer';
import { EditShopSheet } from '@/features/settings/EditShopSheet';
import { PaymentQrSheet } from '@/features/settings/PaymentQrSheet';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  getAppLockState,
  isBiometricAvailable,
  setBiometricEnabled,
  type AppLockState,
} from '@/services/applock';
import { can } from '@/services/permissions';
import {
  exportShopDataJson,
  getLastBackupAt,
  getProfileCompletion,
  resetShopData,
  setDecimalEnabled,
  setLastBackupAt,
} from '@/services/shop';
import { useSession } from '@/store/session';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme, type ThemePref } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppHeader,
  AppText,
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  Loading,
  Screen,
  Segmented,
  SettingsRow,
  useToast,
} from '@/ui';

const WEB_APP_URL = 'https://sohannote.app';
const SUPPORT_PHONE = '+8801800000000';
const SUPPORT_EMAIL = 'support@sohannote.app';

export default function SettingsScreen() {
  const { colors, pref, setPref } = useTheme();
  const toast = useToast();
  const user = useSession((s) => s.user);
  const { shopId, userId, role, shop } = useCurrentShop();

  const canManageSettings = can(role, 'manageSettings');
  const canManageEmployees = can(role, 'manageEmployees');
  const canRestore = can(role, 'restore');

  const [editOpen, setEditOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [webAppOpen, setWebAppOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [lastBackupAt, setLastBackupState] = useState<number | null>(null);

  const [lockState, setLockState] = useState<AppLockState>({
    enabled: false,
    hasPin: false,
    biometricEnabled: false,
  });
  const [bioAvailable, setBioAvailable] = useState(false);
  const [lockModal, setLockModal] = useState<AppLockModalMode | null>(null);

  const refreshMeta = useCallback(() => {
    setLastBackupState(getLastBackupAt(db));
    void getAppLockState().then(setLockState).catch(() => undefined);
    void isBiometricAvailable().then(setBioAvailable).catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshMeta();
    }, [refreshMeta]),
  );

  if (!shop || !shopId || !role) {
    return (
      <Screen header={<AppHeader title="Settings" />} scroll={false}>
        <Loading label="Loading shop settings…" />
      </Screen>
    );
  }

  const completion = getProfileCompletion(shop);
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const storefrontUrl = shop.slug ? `${WEB_APP_URL}/s/${shop.slug}` : WEB_APP_URL;

  const handleDecimalToggle = (next: boolean) => {
    try {
      setDecimalEnabled(db, shopId, role, next);
      toast.show(next ? 'Decimal paisa display enabled' : 'Decimal display turned off', 'info');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleBackupNow = async () => {
    setBackingUp(true);
    try {
      if (isSupabaseConfigured && user) {
        await hydrateUserShops(db, user);
      }
      const ts = Date.now();
      setLastBackupAt(db, ts);
      setLastBackupState(ts);
      toast.show(
        isSupabaseConfigured ? 'Backup synced' : 'Local backup timestamp recorded',
        'success',
      );
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const handleDownloadData = async () => {
    setDownloading(true);
    try {
      const json = exportShopDataJson(db, shopId, role);
      await shareShopDataJson(json, shop.name);
      toast.show('Shop data exported as JSON', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleResetShop = () => {
    setResetting(true);
    try {
      const count = resetShopData(db, shopId, role);
      setResetConfirm(false);
      toast.show(`Cleared ${count} records from ${shop.name}`, 'info');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleToggleAppLock = (next: boolean) => {
    if (next) {
      setLockModal('setup');
    } else {
      setLockModal('disable');
    }
  };

  const handleToggleBiometric = async (next: boolean) => {
    try {
      await setBiometricEnabled(next);
      setLockState((prev) => ({ ...prev, biometricEnabled: next }));
      toast.show(next ? 'Biometric unlock enabled' : 'Biometric unlock disabled', 'info');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleCopyWebLink = async () => {
    await Clipboard.setStringAsync(storefrontUrl);
    toast.show('Link copied to clipboard', 'success');
  };

  const handleShareWebLink = async () => {
    try {
      await Share.share({
        message: `${shop.name} — ${storefrontUrl}`,
        url: storefrontUrl,
      });
    } catch {
      // User dismissed share sheet
    }
  };

  const handleLogout = async () => {
    setLogoutConfirm(false);
    await signOutAll();
    router.replace('/(auth)/login');
  };

  const openWhatsAppSupport = () => {
    const cleanPhone = SUPPORT_PHONE.replace(/[^0-9]/g, '');
    const msg = encodeURIComponent(`Hi Sohan Note Ultra support, I need help with "${shop.name}".`);
    void Linking.openURL(`https://wa.me/${cleanPhone}?text=${msg}`).catch(() => {
      toast.show('Could not open WhatsApp', 'error');
    });
  };

  return (
    <Screen header={<AppHeader title="Settings" />}>
      {/* Profile Card */}
      <Card style={styles.profileCard}>
        <View style={styles.profileRow}>
          {shop.logo_uri ? (
            <Image source={{ uri: shop.logo_uri }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="account-circle" size={44} color={colors.textMuted} />
            </View>
          )}
          <View style={styles.flex}>
            <AppText bold numberOfLines={1}>
              {shop.name}
            </AppText>
            <AppText variant="label" muted style={styles.roleText}>
              {role.toUpperCase()}
            </AppText>
            <AppText variant="secondary" muted numberOfLines={1}>
              {shop.phone || user?.email || 'No contact info'}
            </AppText>
          </View>
          {canManageSettings ? (
            <Button label="Edit" variant="outline" onPress={() => setEditOpen(true)} />
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!canManageSettings}
          onPress={() => setEditOpen(true)}
          style={styles.completionWrap}
        >
          <View style={styles.completionHeader}>
            <AppText variant="secondary" bold>
              Profile status
            </AppText>
            <AppText
              variant="secondary"
              bold
              style={{ color: completion.percent === 100 ? colors.success : colors.danger }}
            >
              {completion.percent}%
            </AppText>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${completion.percent}%`,
                  backgroundColor: completion.percent === 100 ? colors.success : colors.primary,
                },
              ]}
            />
          </View>
          <AppText variant="label" muted>
            {completion.percent === 100
              ? 'Profile complete — your digital business card is ready!'
              : 'Complete 100% profile info to get your complete digital business card'}
          </AppText>
        </Pressable>
      </Card>

      {/* Change shop CTA */}
      <Button
        label="Change shop"
        variant="yellow"
        icon="store-cog-outline"
        onPress={() => router.push('/shops')}
        fullWidth
      />

      {/* App settings section */}
      <AppText variant="label" muted style={styles.sectionLabel}>
        App settings
      </AppText>

      <View style={styles.group}>
        {/* Expandable Sohan Note App Settings */}
        <View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAppSettingsOpen((o) => !o)}
            style={[
              styles.accordionHeader,
              {
                backgroundColor: appSettingsOpen ? colors.accent : colors.surfaceMuted,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="cog-outline"
              size={22}
              color={appSettingsOpen ? '#FFFFFF' : colors.accent}
            />
            <AppText
              bold={appSettingsOpen}
              style={[styles.flex, { color: appSettingsOpen ? '#FFFFFF' : colors.text }]}
            >
              Sohan Note App Settings
            </AppText>
            <MaterialCommunityIcons
              name={appSettingsOpen ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={appSettingsOpen ? '#FFFFFF' : colors.textMuted}
            />
          </Pressable>

          {appSettingsOpen ? (
            <Card style={styles.accordionBody}>
              {canManageSettings ? (
                <>
                  <SettingsRow
                    icon="qrcode"
                    label="bKash / Nagad Payment QR"
                    kind="arrow"
                    onPress={() => setQrOpen(true)}
                  />
                  <SettingsRow
                    icon="shape-outline"
                    label="Custom categories"
                    kind="arrow"
                    onPress={() => setCatOpen(true)}
                  />
                  <SettingsRow
                    icon="decimal"
                    label="Decimal point (৳ 0.00)"
                    kind="switch"
                    value={shop.decimal_enabled === 1}
                    onValueChange={handleDecimalToggle}
                  />
                </>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={backingUp}
                onPress={handleBackupNow}
                style={[styles.subRow, { backgroundColor: colors.surfaceMuted }]}
              >
                <MaterialCommunityIcons name="cloud-upload-outline" size={22} color={colors.accent} />
                <View style={styles.flex}>
                  <AppText>{backingUp ? 'Backing up…' : 'Data backup'}</AppText>
                  <AppText variant="label" muted>
                    {lastBackupAt
                      ? `Last backup: ${formatDateTime(lastBackupAt)}`
                      : 'Not backed up yet · tap to sync'}
                  </AppText>
                </View>
                <MaterialCommunityIcons name="arrow-right" size={20} color={colors.textMuted} />
              </Pressable>

              {canRestore ? (
                <SettingsRow
                  icon="delete-restore"
                  label="Recycle bin"
                  kind="arrow"
                  onPress={() => router.push('/recycle-bin')}
                />
              ) : null}

              <SettingsRow
                icon="lock-outline"
                label="App lock (PIN)"
                kind="switch"
                value={lockState.enabled}
                onValueChange={handleToggleAppLock}
              />

              {lockState.enabled ? (
                <View style={styles.nestedLock}>
                  <SettingsRow
                    icon="key-change"
                    label="Change PIN"
                    kind="arrow"
                    onPress={() => setLockModal('change')}
                  />
                  {bioAvailable ? (
                    <SettingsRow
                      icon="fingerprint"
                      label="Biometric unlock"
                      kind="switch"
                      value={lockState.biometricEnabled}
                      onValueChange={handleToggleBiometric}
                    />
                  ) : null}
                </View>
              ) : null}

              {canManageSettings ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    disabled={downloading}
                    onPress={handleDownloadData}
                    style={[styles.subRow, { backgroundColor: colors.surfaceMuted }]}
                  >
                    <MaterialCommunityIcons
                      name="cloud-download-outline"
                      size={22}
                      color={colors.accent}
                    />
                    <View style={styles.flex}>
                      <AppText>{downloading ? 'Exporting JSON…' : 'Data download'}</AppText>
                      <AppText variant="label" muted>
                        Download all shop data as JSON
                      </AppText>
                    </View>
                    <MaterialCommunityIcons name="arrow-right" size={20} color={colors.textMuted} />
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setResetConfirm(true)}
                    style={[styles.subRow, { backgroundColor: colors.surfaceMuted }]}
                  >
                    <MaterialCommunityIcons name="restore-alert" size={22} color={colors.danger} />
                    <View style={styles.flex}>
                      <AppText style={{ color: colors.danger }}>App reset</AppText>
                      <AppText variant="label" style={{ color: colors.danger }}>
                        Resetting will erase all shop records
                      </AppText>
                    </View>
                    <MaterialCommunityIcons name="arrow-right" size={20} color={colors.danger} />
                  </Pressable>
                </>
              ) : null}
            </Card>
          ) : null}
        </View>

        {/* Expandable Web App link */}
        <View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setWebAppOpen((o) => !o)}
            style={[
              styles.accordionHeader,
              { backgroundColor: webAppOpen ? colors.accent : colors.surfaceMuted },
            ]}
          >
            <MaterialCommunityIcons
              name="web"
              size={22}
              color={webAppOpen ? '#FFFFFF' : colors.accent}
            />
            <AppText
              bold={webAppOpen}
              style={[styles.flex, { color: webAppOpen ? '#FFFFFF' : colors.text }]}
            >
              Web app
            </AppText>
            <MaterialCommunityIcons
              name={webAppOpen ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={webAppOpen ? '#FFFFFF' : colors.textMuted}
            />
          </Pressable>
          {webAppOpen ? (
            <Card style={styles.webBox}>
              <AppText variant="secondary" muted>
                Open this link in your computer or mobile browser:
              </AppText>
              <View style={[styles.urlBox, { backgroundColor: colors.surfaceMuted }]}>
                <AppText variant="secondary" numberOfLines={1} style={styles.flex}>
                  {storefrontUrl}
                </AppText>
              </View>
              <View style={styles.rowGap}>
                <Button
                  label="Copy link"
                  variant="outline"
                  icon="content-copy"
                  onPress={handleCopyWebLink}
                  style={styles.flex}
                />
                <Button
                  label="Share"
                  icon="share-variant"
                  onPress={handleShareWebLink}
                  style={styles.flex}
                />
              </View>
            </Card>
          ) : null}
        </View>

        <SettingsRow icon="currency-bdt" label="Currency" kind="value" value="BDT | ৳" />

        {/* Theme selector */}
        <View style={[styles.themeRow, { backgroundColor: colors.surfaceMuted }]}>
          <View style={styles.themeTop}>
            <MaterialCommunityIcons name="theme-light-dark" size={22} color={colors.accent} />
            <AppText style={styles.flex}>Theme</AppText>
          </View>
          <Segmented<ThemePref>
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={pref}
            onChange={setPref}
          />
        </View>

        <SettingsRow
          icon="card-account-details-outline"
          label="Business card"
          kind="arrow"
          onPress={() => router.push('/business-card')}
        />

        {canManageEmployees ? (
          <SettingsRow
            icon="account-key-outline"
            label="App access (Employees)"
            kind="arrow"
            onPress={() => router.push('/access')}
          />
        ) : null}
      </View>

      {/* Others section */}
      <AppText variant="label" muted style={styles.sectionLabel}>
        Others
      </AppText>

      <View style={styles.group}>
        <SettingsRow
          icon="lightbulb-on-outline"
          label="Feature request"
          kind="arrow"
          onPress={() => {
            void Linking.openURL(
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Feature Request - Sohan Note Ultra')}`,
            ).catch(() => toast.show(`Email us at ${SUPPORT_EMAIL}`, 'info'));
          }}
        />
        <SettingsRow
          icon="headset"
          label="Help & support"
          kind="arrow"
          onPress={() => setHelpOpen(true)}
        />
      </View>

      <AppText variant="label" muted style={styles.version}>
        Version: {appVersion}
      </AppText>

      {/* Full-width Logout pill (#FF4F2B) */}
      <Pressable
        accessibilityRole="button"
        onPress={() => setLogoutConfirm(true)}
        style={[styles.logoutBtn, { backgroundColor: colors.logout }]}
      >
        <MaterialCommunityIcons name="logout" size={20} color="#FFFFFF" />
        <AppText bold style={styles.logoutText}>
          Log out
        </AppText>
      </Pressable>

      {/* Modals & Sheets */}
      <EditShopSheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        shop={shop}
        role={role}
      />

      <PaymentQrSheet
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        shop={shop}
        role={role}
      />

      <CategoriesSheet
        visible={catOpen}
        onClose={() => setCatOpen(false)}
        shopId={shopId}
        userId={userId}
        role={role}
      />

      <AppLockModal
        visible={lockModal !== null}
        mode={lockModal ?? 'setup'}
        allowBiometric={lockState.biometricEnabled}
        onClose={() => setLockModal(null)}
        onSuccess={refreshMeta}
      />

      <BottomSheet visible={helpOpen} onClose={() => setHelpOpen(false)} title="Help & support">
        <AppText variant="secondary" muted>
          Need help with your shop, cloud sync, or employees? Reach out directly.
        </AppText>
        <Button
          label="Chat on WhatsApp"
          icon="whatsapp"
          onPress={openWhatsAppSupport}
          fullWidth
        />
        <Button
          label={`Email ${SUPPORT_EMAIL}`}
          variant="outline"
          icon="email-outline"
          onPress={() => {
            void Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() =>
              toast.show(SUPPORT_EMAIL, 'info'),
            );
          }}
          fullWidth
        />
      </BottomSheet>

      <ConfirmDialog
        visible={resetConfirm}
        title="Reset all shop data?"
        message={`All products, sales, purchases, expenses, contacts, cash entries, and categories in "${shop.name}" will be erased. Your shop profile and team members stay intact.`}
        confirmLabel="Reset data"
        destructive
        loading={resetting}
        onCancel={() => setResetConfirm(false)}
        onConfirm={handleResetShop}
      />

      <ConfirmDialog
        visible={logoutConfirm}
        title="Log out?"
        message="You can sign back in anytime with your Google account."
        confirmLabel="Log out"
        destructive
        onCancel={() => setLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileCard: { padding: 14, gap: 14 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleText: { letterSpacing: 0.6 },
  completionWrap: { gap: 6 },
  completionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  sectionLabel: { marginTop: 4 },
  group: { gap: 8 },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.row,
  },
  accordionBody: { marginTop: 6, gap: 8, padding: 10 },
  nestedLock: { paddingLeft: 16, gap: 8 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.row,
  },
  webBox: { marginTop: 6, gap: 10, padding: 12 },
  urlBox: { padding: 10, borderRadius: radius.row },
  rowGap: { flexDirection: 'row', gap: 10 },
  themeRow: {
    padding: 14,
    borderRadius: radius.row,
    gap: 10,
  },
  themeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  version: { textAlign: 'center', marginTop: 8 },
  logoutBtn: {
    minHeight: 48,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  logoutText: { color: '#FFFFFF', fontSize: 16 },
  flex: { flex: 1 },
});
