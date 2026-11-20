import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, eq, isNull } from 'drizzle-orm';
import { useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Switch, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { db, expoDb } from '@/db/client';
import { online_orders, products } from '@/db/schema';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import {
  pickAndImportBackupFile,
  shareShopBackupFile,
} from '@/services/backup';
import {
  buildStorefrontUrl,
  updateStoreSettings,
} from '@/services/online';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import {
  scheduleSync,
  triggerManualSync,
  useSyncLifecycle,
  useSyncStore,
} from '@/sync';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppHeader,
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  EmptyState,
  IconGrid,
  Loading,
  Screen,
  SectionCard,
  useToast,
  type IconName,
  type IconTileProps,
} from '@/ui';

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statBox, { backgroundColor: colors.surfaceMuted }]}>
      <AppText variant="label" muted numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="title" style={{ color }} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.quickBtn,
        { backgroundColor: colors.surfaceMuted, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={24} color={colors.accent} />
      <AppText variant="label" bold numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function OnlineDashboardScreen({ back = false }: { back?: boolean }) {
  useSyncLifecycle();
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, role, shop } = useCurrentShop();
  const syncStatus = useSyncStore((s) => s.status);
  const syncing = useSyncStore((s) => s.syncing);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const lastError = useSyncStore((s) => s.lastError);
  const pendingCount = useSyncStore((s) => s.pendingCount);

  const [qrOpen, setQrOpen] = useState(false);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [busyFile, setBusyFile] = useState(false);

  const canManage = can(role, 'manageOnline');
  const canBackupFile = can(role, 'manageSettings');

  const { data: orderRows } = useLiveQuery(
    expoDb
      .select()
      .from(online_orders)
      .where(and(eq(online_orders.shop_id, shopId ?? ''), isNull(online_orders.deleted_at))),
    [shopId],
  );

  const { data: productRows } = useLiveQuery(
    expoDb
      .select({
        id: products.id,
        online_visible: products.online_visible,
        featured: products.featured,
      })
      .from(products)
      .where(and(eq(products.shop_id, shopId ?? ''), isNull(products.deleted_at))),
    [shopId],
  );

  const stats = useMemo(() => {
    let activeOrders = 0;
    let pendingOrders = 0;
    let earned = 0;
    for (const o of orderRows) {
      if (o.status === 'pending') {
        pendingOrders += 1;
        activeOrders += 1;
      } else if (o.status === 'confirmed') {
        activeOrders += 1;
      } else if (o.status === 'delivered') {
        earned += o.total;
      }
    }
    let onlineProducts = 0;
    for (const p of productRows) {
      if (p.online_visible === 1) onlineProducts += 1;
    }
    return {
      activeOrders,
      pendingOrders,
      onlineProducts,
      earned,
      visits: shop?.online_visits ?? 0,
    };
  }, [orderRows, productRows, shop?.online_visits]);

  const slug = shop?.slug ?? null;
  const onlineEnabled = shop?.online_enabled === 1;
  const decimal = shop?.decimal_enabled === 1;
  const storefrontUrl = slug ? buildStorefrontUrl(slug) : '';

  const handleManualSync = async () => {
    try {
      const res = await triggerManualSync();
      if (res.errors.length > 0) {
        toast.show(res.errors[0].message, 'error');
      } else {
        toast.show(
          `Backup complete (${res.pushed} pushed, ${res.pulled} pulled)`,
          'success',
        );
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleToggleOnline = (next: boolean) => {
    if (!shopId || !role) return;
    if (!canManage) {
      toast.show('Only owners and managers can change online status', 'error');
      return;
    }
    if (next && !slug) {
      router.push('/online/store-settings');
      toast.show('Set your store link first', 'info');
      return;
    }
    try {
      updateStoreSettings(db, { shopId, role, online_enabled: next });
      scheduleSync();
      toast.show(next ? 'Online shop is now live' : 'Online shop turned off', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleOpenWebsite = () => {
    if (!slug) {
      toast.show('Set a store link in Store settings first', 'info');
      router.push('/online/store-settings');
      return;
    }
    router.push({ pathname: '/s/[slug]', params: { slug } });
  };

  const handleCopyLink = async () => {
    if (!storefrontUrl) {
      toast.show('Set a store link in Store settings first', 'info');
      return;
    }
    await Clipboard.setStringAsync(storefrontUrl);
    toast.show('Store link copied', 'success');
  };

  const handleShareLink = async () => {
    if (!storefrontUrl || !shop) return;
    try {
      await Share.share({
        message: `Shop online at ${shop.name}: ${storefrontUrl}`,
        url: storefrontUrl,
      });
    } catch {
      // User dismissed share sheet.
    }
  };

  const handleExportJson = async () => {
    if (!shopId || !role) return;
    setBusyFile(true);
    try {
      const out = await shareShopBackupFile(db, shopId, role);
      toast.show(`Backup exported: ${out.filename}`, 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBusyFile(false);
    }
  };

  const handleImportJson = async () => {
    if (!shopId || !role) return;
    setImportConfirmOpen(false);
    setBusyFile(true);
    try {
      const res = await pickAndImportBackupFile(db, {
        role,
        targetShopId: shopId,
        mode: 'merge',
      });
      if (res) {
        scheduleSync(500);
        toast.show(`Restored ${res.importedRows} records`, 'success');
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBusyFile(false);
    }
  };

  const header = back ? (
    <AppHeader
      title="Online Shop"
      back={true}
      right={[
        {
          icon: 'sync',
          label: 'Sync now',
          onPress: () => void handleManualSync(),
        },
      ]}
    />
  ) : (
    <AppHeader
      variant="home"
      title={shop?.name ?? 'Online Shop'}
      subtitle={
        <AppText
          variant="label"
          style={{ color: lastSyncedAt ? colors.onPrimary : colors.danger }}
          numberOfLines={1}
        >
          {lastSyncedAt ? `Last backup: ${formatDateTime(lastSyncedAt)}` : 'Not backed up yet'}
        </AppText>
      }
      pill={{
        label: syncing ? 'Syncing…' : 'Data backup',
        onPress: () => void handleManualSync(),
      }}
      right={[
        {
          icon: 'bell-outline',
          label: 'Notifications',
          onPress: () => router.push('/notifications'),
        },
        {
          icon: 'cog-outline',
          label: 'Settings',
          onPress: () => router.push('/settings'),
        },
      ]}
    />
  );

  if (!shopId) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState icon="store-off-outline" title="No shop selected" />
      </Screen>
    );
  }

  if (!shop) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading online shop…" />
      </Screen>
    );
  }

  const manageTiles: IconTileProps[] = [
    {
      icon: 'store-cog-outline',
      label: 'Store settings',
      color: '#1A5DD6',
      onPress: () => router.push('/online/store-settings'),
    },
    {
      icon: 'package-variant',
      label: 'Online products',
      color: '#2E9E5B',
      onPress: () => router.push('/online/products'),
    },
    {
      icon: 'clipboard-list-outline',
      label: 'Order list',
      color: '#E67E22',
      badge: stats.pendingOrders,
      onPress: () => router.push('/online/orders'),
    },
    {
      icon: 'star-circle-outline',
      label: 'Featured products',
      color: '#D97706',
      onPress: () => router.push('/online/featured'),
    },
    {
      icon: 'truck-delivery-outline',
      label: 'Delivery charges',
      color: '#0891B2',
      onPress: () => router.push('/online/delivery'),
    },
    {
      icon: 'file-document-outline',
      label: 'Shop policy',
      color: '#7C3AED',
      onPress: () => router.push('/online/policy'),
    },
    {
      icon: 'palette-outline',
      label: 'Themes',
      color: '#DB2777',
      onPress: () => router.push('/online/themes'),
    },
  ];

  const syncTone =
    syncStatus === 'error'
      ? 'danger'
      : syncStatus === 'offline'
        ? 'warning'
        : syncStatus === 'syncing'
          ? 'neutral'
          : 'success';

  const syncLabel =
    syncStatus === 'syncing'
      ? 'Syncing…'
      : syncStatus === 'offline'
        ? 'Offline'
        : syncStatus === 'error'
          ? 'Attention'
          : 'Synced';

  return (
    <Screen header={header}>
      {/* Live Status Banner */}
      <Card style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={styles.flex}>
            <View style={styles.badgeRow}>
              <AppText bold>Online Storefront</AppText>
              <Badge
                label={onlineEnabled ? 'Live' : 'Off'}
                tone={onlineEnabled ? 'success' : 'warning'}
              />
            </View>
            <AppText variant="label" muted numberOfLines={1}>
              {slug ? storefrontUrl : 'Set a store link to publish your shop online'}
            </AppText>
          </View>
          {canManage ? (
            <Switch
              accessibilityLabel="Enable online shop"
              value={onlineEnabled}
              onValueChange={handleToggleOnline}
              trackColor={{ true: colors.success }}
            />
          ) : null}
        </View>
        {!slug && canManage ? (
          <Button
            label="Set up store link"
            variant="yellow"
            icon="store-cog-outline"
            onPress={() => router.push('/online/store-settings')}
          />
        ) : null}
      </Card>

      {/* 2x2 Stats Card */}
      <Card style={styles.statsCard}>
        <View style={styles.statsRow}>
          <StatBox
            label="Active orders"
            value={String(stats.activeOrders)}
            color={colors.accent}
          />
          <StatBox
            label="Online products"
            value={String(stats.onlineProducts)}
            color={colors.success}
          />
        </View>
        <View style={styles.statsRow}>
          <StatBox
            label="Earned"
            value={formatTaka(stats.earned, decimal)}
            color={colors.success}
          />
          <StatBox
            label="Website visits"
            value={String(stats.visits)}
            color={colors.text}
          />
        </View>
      </Card>

      {/* Website / Copy link / QR code */}
      <Card style={styles.quickRow}>
        <QuickAction
          icon="web"
          label="Website"
          disabled={!slug}
          onPress={handleOpenWebsite}
        />
        <QuickAction
          icon="content-copy"
          label="Copy link"
          disabled={!slug}
          onPress={() => void handleCopyLink()}
        />
        <QuickAction
          icon="qrcode"
          label="QR code"
          disabled={!slug}
          onPress={() => setQrOpen(true)}
        />
      </Card>

      {/* Manage Online Shop Grid */}
      {canManage ? (
        <SectionCard title="Manage online shop">
          <IconGrid items={manageTiles} />
        </SectionCard>
      ) : (
        <Card>
          <View style={styles.noticeRow}>
            <MaterialCommunityIcons name="lock-outline" size={20} color={colors.textMuted} />
            <AppText variant="secondary" muted style={styles.flex}>
              Store configuration and order management are restricted to Owners and Managers.
            </AppText>
          </View>
        </Card>
      )}

      {/* Sync & JSON Backup Card */}
      <SectionCard title="Cloud sync & backup">
        <View style={styles.syncHeader}>
          <View style={styles.flex}>
            <View style={styles.badgeRow}>
              <Badge label={syncLabel} tone={syncTone} />
              <AppText variant="label" muted>
                {pendingCount === 0
                  ? 'All changes backed up'
                  : `${pendingCount} unsynced ${pendingCount === 1 ? 'change' : 'changes'}`}
              </AppText>
            </View>
            {lastSyncedAt ? (
              <AppText variant="label" muted>
                Last backup: {formatDateTime(lastSyncedAt)}
              </AppText>
            ) : null}
            {lastError ? (
              <AppText variant="label" style={{ color: colors.danger }}>
                {lastError}
              </AppText>
            ) : null}
          </View>
          <Button
            label="Sync"
            icon="cloud-sync-outline"
            variant="outline"
            loading={syncing}
            onPress={() => void handleManualSync()}
          />
        </View>

        {canBackupFile ? (
          <>
            <Divider />
            <View style={styles.backupActions}>
              <Button
                label="Export JSON"
                icon="download-outline"
                variant="outline"
                loading={busyFile}
                onPress={() => void handleExportJson()}
                style={styles.flex}
              />
              <Button
                label="Import JSON"
                icon="upload-outline"
                variant="outline"
                loading={busyFile}
                onPress={() => setImportConfirmOpen(true)}
                style={styles.flex}
              />
            </View>
          </>
        ) : null}
      </SectionCard>

      {/* QR Code Sheet */}
      <BottomSheet
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Storefront QR Code"
      >
        <View style={styles.qrWrap}>
          <AppText bold>{shop.name}</AppText>
          <View style={styles.qrBox}>
            {storefrontUrl ? (
              <QRCode value={storefrontUrl} size={200} backgroundColor="#FFFFFF" color="#1B1B1B" />
            ) : null}
          </View>
          <AppText variant="secondary" muted style={styles.centerText}>
            {storefrontUrl}
          </AppText>
          <View style={styles.qrActions}>
            <Button
              label="Copy link"
              icon="content-copy"
              variant="outline"
              onPress={() => void handleCopyLink()}
              style={styles.flex}
            />
            <Button
              label="Share"
              icon="share-variant"
              onPress={() => void handleShareLink()}
              style={styles.flex}
            />
          </View>
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={importConfirmOpen}
        title="Import JSON backup?"
        message="This will merge records from the selected backup file into your current shop and queue them for cloud sync."
        confirmLabel="Choose file"
        onCancel={() => setImportConfirmOpen(false)}
        onConfirm={() => void handleImportJson()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  statusCard: { gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statsCard: { gap: 10 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statBox: {
    flex: 1,
    borderRadius: radius.row,
    padding: 12,
    gap: 4,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickBtn: {
    flex: 1,
    borderRadius: radius.row,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  syncHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  backupActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  qrWrap: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: radius.card,
  },
  centerText: { textAlign: 'center' },
  qrActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
});
