import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { errorMessage } from '@/lib/errors';
import { backupNow } from '@/services/backup';
import {
  dismissSetupCard,
  getDashboardStats,
  getDirtyRecordCount,
  getLastBackupAt,
  getNotificationCount,
  getSetupProgress,
  type DashboardPeriod,
} from '@/services/dashboard';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import {
  AppText,
  BigActionButton,
  Button,
  Card,
  EmptyState,
  IconGrid,
  Loading,
  Screen,
  SectionCard,
  useToast,
  type IconTileProps,
} from '@/ui';
import { HomeHeader } from '@/features/home/HomeHeader';
import {
  BackupStatusSheet,
  PrinterSetupSheet,
  StaffAccountSheet,
  SupportSheet,
} from '@/features/home/HomeModals';
import { SetupProgressCard } from '@/features/home/SetupProgressCard';
import { StatsCard } from '@/features/home/StatsCard';
import { useLiveRefresh } from '@/features/home/useLiveRefresh';

export default function HomeScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, role, shop } = useCurrentShop();
  const [period, setPeriod] = useState<DashboardPeriod>('day');
  const [refreshing, setRefreshing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [tick, refresh] = useLiveRefresh();

  const decimal = shop?.decimal_enabled === 1;
  const shopName = shop?.name ?? 'Sohan Note Ultra';

  const data = useMemo(() => {
    void tick;
    if (!shopId) return null;
    try {
      return {
        stats: getDashboardStats(db, shopId, { period, role }),
        setup: getSetupProgress(db, shopId),
        lastBackupAt: getLastBackupAt(db, shopId),
        dirtyCount: getDirtyRecordCount(db, shopId),
        unreadNotifications: getNotificationCount(db, shopId, { role }),
        error: null as string | null,
      };
    } catch (e) {
      return {
        stats: null,
        setup: null,
        lastBackupAt: null,
        dirtyCount: 0,
        unreadNotifications: 0,
        error: errorMessage(e),
      };
    }
  }, [shopId, period, role, tick]);

  const navigate = (path: string) => {
    router.push(path as Href);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 200);
  };

  const handleDismissSetup = () => {
    if (!shopId) return;
    try {
      dismissSetupCard(db, shopId, true);
      refresh();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleBackupNow = async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const res = await backupNow(db);
      refresh();
      if (res.errors.length > 0) {
        toast.show(res.errors[0].message, 'error');
      } else {
        toast.show(`Backup complete (${res.pushed} sent, ${res.pulled} updated)`, 'success');
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
      setBackupOpen(true);
    } finally {
      setBackingUp(false);
    }
  };

  const canManageSettings = can(role, 'manageSettings');
  const canBuy = can(role, 'buy');
  const canSell = can(role, 'sell');
  const canViewCashbox = can(role, 'viewCashbox');

  const ledgerItems: IconTileProps[] = useMemo(() => {
    const items: IconTileProps[] = [];
    if (can(role, 'buy')) {
      items.push({
        icon: 'clipboard-text-outline',
        label: 'Purchase ledger',
        color: '#0D9488',
        onPress: () => navigate('/purchases'),
      });
    }
    if (can(role, 'sell')) {
      items.push({
        icon: 'receipt-text-outline',
        label: 'Sales ledger',
        color: '#1A5DD6',
        onPress: () => navigate('/sales'),
      });
    }
    if (can(role, 'collectDue')) {
      items.push({
        icon: 'book-account-outline',
        label: 'Due ledger',
        color: '#EA580C',
        onPress: () => navigate('/due'),
      });
    }
    if (can(role, 'addExpense')) {
      items.push({
        icon: 'wallet-outline',
        label: 'Expense ledger',
        color: '#E53935',
        onPress: () => navigate('/expenses'),
      });
    }
    return items;
  }, [role]);

  const lowStockCount = data?.stats?.lowStockCount ?? 0;

  const businessItems: IconTileProps[] = useMemo(() => {
    const items: IconTileProps[] = [];
    if (can(role, 'manageParties')) {
      items.push({
        icon: 'account-group-outline',
        label: 'Contacts',
        color: '#7C3AED',
        onPress: () => navigate('/contacts'),
      });
    }
    if (can(role, 'viewProducts')) {
      items.push({
        icon: 'package-variant-closed',
        label: 'Product list',
        color: '#D97706',
        onPress: () => navigate('/products'),
      });
    }
    if (can(role, 'viewStock')) {
      items.push({
        icon: 'warehouse',
        label: 'Stock',
        color: '#059669',
        badge: lowStockCount > 0 ? lowStockCount : undefined,
        onPress: () => navigate('/stock'),
      });
    }
    if (can(role, 'viewReports')) {
      items.push({
        icon: 'chart-box-outline',
        label: 'Business report',
        color: '#2563EB',
        onPress: () => navigate('/(tabs)/reports'),
      });
    }
    return items;
  }, [role, lowStockCount]);

  const otherItems: IconTileProps[] = useMemo(() => {
    const items: IconTileProps[] = [];
    if (can(role, 'viewCashbox')) {
      items.push({
        icon: 'cash-register',
        label: 'Cashbox',
        color: '#2E9E5B',
        onPress: () => navigate('/cashbox'),
      });
    }
    if (can(role, 'manageEmployees')) {
      items.push({
        icon: 'account-key-outline',
        label: 'App access',
        color: '#475569',
        onPress: () => navigate('/access'),
      });
    }
    if (can(role, 'sell')) {
      items.push({
        icon: 'shield-check-outline',
        label: 'Warranty',
        color: '#0891B2',
        onPress: () => navigate('/warranty'),
      });
    }
    items.push({
      icon: 'printer-outline',
      label: 'Printer',
      color: '#4F46E5',
      onPress: () => setPrinterOpen(true),
    });
    if (can(role, 'manageCapital')) {
      items.push({
        icon: 'bank-outline',
        label: 'Capital',
        color: '#15803D',
        onPress: () => navigate('/capital'),
      });
    }
    if (can(role, 'restore')) {
      items.push({
        icon: 'trash-can-outline',
        label: 'Recycle bin',
        color: '#DC2626',
        onPress: () => navigate('/recycle-bin'),
      });
    }
    return items;
  }, [role]);

  const header = (
    <HomeHeader
      shopName={shopName}
      lastBackupAt={data?.lastBackupAt ?? null}
      unreadNotifications={data?.unreadNotifications ?? 0}
      backingUp={backingUp}
      canManageSettings={canManageSettings}
      onPressShop={() => navigate('/shops')}
      onPressBackup={() => void handleBackupNow()}
      onPressSupport={() => setSupportOpen(true)}
      onPressNotifications={() => navigate('/notifications')}
      onPressSettings={() => {
        if (canManageSettings) navigate('/settings');
        else setAccountOpen(true);
      }}
    />
  );

  if (!shopId || !data) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading shop…" />
      </Screen>
    );
  }

  if (data.error || !data.stats) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load dashboard"
          message={data.error ?? 'Unexpected error'}
          action={{ label: 'Retry', onPress: refresh }}
        />
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll={false} padded={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {data.setup && (canManageSettings || can(role, 'manageProducts')) ? (
          <SetupProgressCard
            progress={data.setup}
            onNavigate={navigate}
            onDismiss={handleDismissSetup}
          />
        ) : null}

        <StatsCard
          stats={data.stats}
          period={period}
          decimal={decimal}
          onChangePeriod={setPeriod}
          onPressBalance={canViewCashbox ? () => navigate('/cashbox') : undefined}
          onPressSales={() => navigate('/sales')}
          onPressExpense={() => navigate('/expenses')}
          onPressDue={() => navigate('/due')}
          onPressStock={() => navigate('/stock')}
        />

        {canBuy || canSell ? (
          <View style={styles.bigActions}>
            {canBuy ? (
              <BigActionButton
                icon="cart-arrow-down"
                label="Buy"
                onPress={() => navigate('/buy')}
              />
            ) : null}
            {canSell ? (
              <BigActionButton
                icon="shopping-outline"
                label="Sell"
                onPress={() => navigate('/sell')}
              />
            ) : null}
          </View>
        ) : null}

        {ledgerItems.length > 0 ? (
          <SectionCard title="Ledgers">
            <IconGrid items={ledgerItems} />
          </SectionCard>
        ) : null}

        {businessItems.length > 0 ? (
          <SectionCard title="For your business">
            <IconGrid items={businessItems} />
          </SectionCard>
        ) : null}

        {otherItems.length > 0 ? (
          <SectionCard title="Others">
            <IconGrid items={otherItems} />
          </SectionCard>
        ) : null}

        <Card style={styles.supportCard}>
          <View style={[styles.waCircle, { backgroundColor: colors.success + '20' }]}>
            <MaterialCommunityIcons name="whatsapp" size={26} color={colors.success} />
          </View>
          <View style={styles.supportText}>
            <AppText variant="label" muted>
              Need assistance?
            </AppText>
            <AppText variant="secondary" bold>
              Chat with our support team anytime
            </AppText>
          </View>
          <Button
            label="Live Chat"
            onPress={() => setSupportOpen(true)}
            style={styles.liveChatBtn}
          />
        </Card>
      </ScrollView>

      <PrinterSetupSheet
        visible={printerOpen}
        shopName={shopName}
        onClose={() => setPrinterOpen(false)}
      />
      <SupportSheet
        visible={supportOpen}
        shopName={shopName}
        onClose={() => setSupportOpen(false)}
      />
      <BackupStatusSheet
        visible={backupOpen}
        lastBackupAt={data.lastBackupAt}
        dirtyCount={data.dirtyCount}
        backingUp={backingUp}
        canManageSettings={canManageSettings}
        onClose={() => setBackupOpen(false)}
        onBackupNow={() => {
          setBackupOpen(false);
          void handleBackupNow();
        }}
        onOpenSettings={() => navigate('/settings')}
      />
      <StaffAccountSheet
        visible={accountOpen}
        role={role}
        shopName={shopName}
        onClose={() => setAccountOpen(false)}
        onSwitchShop={() => navigate('/shops')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 12, gap: 12, paddingBottom: 24 },
  bigActions: { flexDirection: 'row', gap: 12 },
  supportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportText: { flex: 1, minWidth: 0 },
  liveChatBtn: { minHeight: 38, paddingHorizontal: 14 },
});
