import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import type { Role } from '@/db/schema';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme';
import type { ThemePref } from '@/theme/ThemeProvider';
import { AppText, Badge, BottomSheet, Button, Divider, Segmented, useToast } from '@/ui';

export function PrinterSetupSheet({
  visible,
  shopName,
  onClose,
}: {
  visible: boolean;
  shopName: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [printing, setPrinting] = useState(false);

  const handleTestPrint = async () => {
    setPrinting(true);
    try {
      const safeName = shopName.replace(/[<>&"]/g, '');
      const html = `<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
        <h2 style="margin:0 0 8px;">${safeName || 'Sohan Note Ultra'}</h2>
        <p style="margin:0 0 12px;color:#555;">System Printer Test Page</p>
        <hr />
        <p>Printed at: ${formatDateTime(Date.now())}</p>
        <p>If you can read this page, system printing works for invoices and business reports.</p>
      </body></html>`;
      await Print.printAsync({ html });
      toast.show('Print dialog opened', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Printer Setup">
      <View style={styles.section}>
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="printer-wireless" size={24} color={colors.accent} />
          <AppText style={styles.flex}>
            Sohan Note Ultra uses your device&apos;s built-in system print service to print PDF
            invoices, party statements, and business reports.
          </AppText>
        </View>
        <Divider />
        <AppText variant="secondary" bold>
          Supported printers
        </AppText>
        <AppText variant="secondary" muted>
          {Platform.OS === 'ios'
            ? '• AirPrint Wi-Fi printers appear automatically in the iOS Print dialog.'
            : Platform.OS === 'android'
              ? '• Enable Default Print Service or your printer brand plugin in Android Settings → Connected devices → Printing.'
              : '• Any printer installed in your browser / OS works via the print dialog or Save as PDF.'}
        </AppText>
        <AppText variant="secondary" muted>
          • You can also share any PDF invoice or report directly to WhatsApp or printer apps.
        </AppText>
      </View>
      <View style={styles.btnRow}>
        <Button label="Close" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label="Test Print"
          icon="printer"
          loading={printing}
          onPress={handleTestPrint}
          style={styles.flex}
        />
      </View>
    </BottomSheet>
  );
}

export function SupportSheet({
  visible,
  shopName,
  onClose,
}: {
  visible: boolean;
  shopName: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const openWhatsApp = async () => {
    const text = encodeURIComponent(
      `Hello Sohan Note Ultra support, I need help with my shop "${shopName}".`,
    );
    const url = `https://wa.me/?text=${text}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        toast.show('WhatsApp is not available on this device', 'info');
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Help & Support">
      <View style={styles.section}>
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="whatsapp" size={28} color={colors.success} />
          <View style={styles.flex}>
            <AppText bold>Live WhatsApp Support</AppText>
            <AppText variant="secondary" muted>
              Reach out anytime for setup help, cloud sync questions, or invoice formatting.
            </AppText>
          </View>
        </View>
        <Divider />
        <AppText variant="label" muted>
          Tip: Use Data backup regularly to keep your shop synced across devices.
        </AppText>
      </View>
      <View style={styles.btnRow}>
        <Button label="Close" variant="outline" onPress={onClose} style={styles.flex} />
        <Button
          label="Open WhatsApp"
          icon="whatsapp"
          onPress={openWhatsApp}
          style={styles.flex}
        />
      </View>
    </BottomSheet>
  );
}

export function BackupStatusSheet({
  visible,
  lastBackupAt,
  dirtyCount,
  backingUp = false,
  canManageSettings,
  onClose,
  onBackupNow,
  onOpenSettings,
}: {
  visible: boolean;
  lastBackupAt: number | null;
  dirtyCount: number;
  backingUp?: boolean;
  canManageSettings: boolean;
  onClose: () => void;
  onBackupNow: () => void;
  onOpenSettings: () => void;
}) {
  const { colors } = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Data Backup">
      <View style={styles.section}>
        <View style={styles.kvRow}>
          <AppText muted>Last backup</AppText>
          <AppText bold>{lastBackupAt ? formatDateTime(lastBackupAt) : 'Never'}</AppText>
        </View>
        <View style={styles.kvRow}>
          <AppText muted>Pending changes</AppText>
          <Badge
            label={dirtyCount > 0 ? `${dirtyCount} pending` : 'Up to date'}
            tone={dirtyCount > 0 ? 'warning' : 'success'}
          />
        </View>
        <Divider />
        <AppText variant="secondary" muted>
          Your records are saved offline first on this device and sync to the cloud whenever you
          are online.
        </AppText>
        {!canManageSettings ? (
          <AppText variant="label" style={{ color: colors.textMuted }}>
            Ask the shop owner to export a full JSON backup from Settings.
          </AppText>
        ) : null}
      </View>
      <View style={styles.btnCol}>
        <Button
          label="Sync & Backup Now"
          icon="cloud-sync-outline"
          loading={backingUp}
          fullWidth
          onPress={onBackupNow}
        />
        <View style={styles.btnRow}>
          <Button label="Close" variant="outline" onPress={onClose} style={styles.flex} />
          {canManageSettings ? (
            <Button
              label="Backup Settings"
              variant="yellow"
              onPress={() => {
                onClose();
                onOpenSettings();
              }}
              style={styles.flex}
            />
          ) : null}
        </View>
      </View>
    </BottomSheet>
  );
}

export function StaffAccountSheet({
  visible,
  role,
  shopName,
  onClose,
  onSwitchShop,
}: {
  visible: boolean;
  role: Role | null;
  shopName: string;
  onClose: () => void;
  onSwitchShop: () => void;
}) {
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const { pref, setPref } = useTheme();

  const handleLogout = async () => {
    onClose();
    try {
      await supabase?.auth.signOut();
    } catch {
      // ignore network error on local signout
    }
    signOut();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Account">
      <View style={styles.section}>
        <View style={styles.kvRow}>
          <View style={styles.flex}>
            <AppText bold>{user?.name ?? 'Team Member'}</AppText>
            <AppText variant="label" muted>
              {user?.email ?? ''}
            </AppText>
          </View>
          {role ? <Badge label={role.toUpperCase()} tone="neutral" /> : null}
        </View>
        <AppText variant="label" muted>
          Current shop: {shopName}
        </AppText>
        <Divider />
        <AppText variant="secondary" muted>
          Appearance
        </AppText>
        <Segmented<ThemePref>
          value={pref}
          onChange={setPref}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </View>
      <View style={styles.btnCol}>
        <Button
          label="Switch Shop"
          variant="yellow"
          icon="store-outline"
          fullWidth
          onPress={() => {
            onClose();
            onSwitchShop();
          }}
        />
        <Button
          label="Logout"
          variant="danger"
          icon="logout"
          fullWidth
          onPress={handleLogout}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flex: { flex: 1 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btnCol: { gap: 8, marginTop: 4 },
});
