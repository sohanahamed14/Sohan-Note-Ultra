import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { formatDateTime } from '@/lib/date';
import { errorMessage } from '@/lib/errors';
import {
  dismissNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  restoreDismissedNotifications,
  type NotificationItem,
} from '@/services/dashboard';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppHeader,
  AppText,
  Button,
  ChipRow,
  EmptyState,
  Loading,
  Screen,
  useToast,
  type HeaderAction,
} from '@/ui';
import { useLiveRefresh } from '@/features/home/useLiveRefresh';

type FilterTab = 'all' | 'online_order' | 'low_stock';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, role, shop } = useCurrentShop();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [tick, refresh] = useLiveRefresh();

  const decimal = shop?.decimal_enabled === 1;
  const canOnline = can(role, 'manageOnline');

  const state = useMemo(() => {
    void tick;
    if (!shopId) return null;
    try {
      const activeItems = getNotifications(db, shopId, { role, decimal, includeDismissed: false });
      const allIncludingDismissed = getNotifications(db, shopId, {
        role,
        decimal,
        includeDismissed: true,
      });
      return {
        items: activeItems,
        dismissedCount: allIncludingDismissed.length - activeItems.length,
        error: null as string | null,
      };
    } catch (e) {
      return { items: [], dismissedCount: 0, error: errorMessage(e) };
    }
  }, [shopId, role, decimal, tick]);

  const filtered = useMemo(() => {
    if (!state) return [];
    if (filter === 'all') return state.items;
    return state.items.filter((i) => i.type === filter);
  }, [state, filter]);

  const unreadCount = state ? state.items.filter((i) => !i.read).length : 0;
  const orderCount = state ? state.items.filter((i) => i.type === 'online_order').length : 0;
  const stockCount = state ? state.items.filter((i) => i.type === 'low_stock').length : 0;

  const handleOpen = (item: NotificationItem) => {
    if (shopId && !item.read) {
      try {
        markNotificationRead(db, shopId, item.id);
        refresh();
      } catch (e) {
        toast.show(errorMessage(e), 'error');
      }
    }
    router.push(item.route as Href);
  };

  const handleDismiss = (item: NotificationItem) => {
    if (!shopId) return;
    try {
      dismissNotification(db, shopId, item.id);
      refresh();
      toast.show('Alert dismissed', 'info');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleMarkAllRead = () => {
    if (!shopId) return;
    try {
      markAllNotificationsRead(db, shopId, { role });
      refresh();
      toast.show('All notifications marked as read', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleRestoreDismissed = () => {
    if (!shopId) return;
    try {
      restoreDismissedNotifications(db, shopId);
      refresh();
      toast.show('Dismissed alerts restored', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const rightActions: HeaderAction[] =
    unreadCount > 0
      ? [{ icon: 'check-all', label: 'Mark all read', onPress: handleMarkAllRead }]
      : [];

  const header = <AppHeader title="Notifications" back right={rightActions} />;

  if (!shopId || !state) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading notifications…" />
      </Screen>
    );
  }

  if (state.error) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load notifications"
          message={state.error}
          action={{ label: 'Retry', onPress: refresh }}
        />
      </Screen>
    );
  }

  const filterOptions: { value: FilterTab; label: string }[] = [
    { value: 'all', label: `All (${state.items.length})` },
    ...(canOnline ? [{ value: 'online_order' as const, label: `Orders (${orderCount})` }] : []),
    { value: 'low_stock', label: `Low Stock (${stockCount})` },
  ];

  return (
    <Screen header={header} scroll={false} padded={false}>
      <View style={styles.filterBar}>
        <ChipRow options={filterOptions} value={filter} onChange={setFilter} />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              refresh();
              setTimeout(() => setRefreshing(false), 180);
            }}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => {
          const toneColor =
            item.severity === 'danger'
              ? colors.danger
              : item.severity === 'warning'
                ? '#D97706'
                : colors.accent;
          const iconName =
            item.type === 'online_order'
              ? 'shopping-outline'
              : item.severity === 'danger'
                ? 'alert-octagon-outline'
                : 'alert-outline';

          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => handleOpen(item)}
              style={[
                styles.rowCard,
                {
                  backgroundColor: item.read ? colors.surface : colors.primarySoft + '55',
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={[styles.iconTile, { backgroundColor: toneColor + '22' }]}>
                <MaterialCommunityIcons name={iconName} size={24} color={toneColor} />
              </View>

              <View style={styles.rowBody}>
                <View style={styles.titleLine}>
                  {!item.read ? (
                    <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />
                  ) : null}
                  <AppText bold={!item.read} numberOfLines={1} style={styles.flex}>
                    {item.title}
                  </AppText>
                </View>
                <AppText variant="secondary" muted numberOfLines={2}>
                  {item.message}
                </AppText>
                <AppText variant="label" muted>
                  {formatDateTime(item.createdAt)}
                </AppText>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Dismiss ${item.title}`}
                onPress={() => handleDismiss(item)}
                hitSlop={8}
                style={styles.dismissBtn}
              >
                <MaterialCommunityIcons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="bell-check-outline"
            title="All caught up"
            message={
              filter === 'online_order'
                ? 'No pending online orders right now.'
                : filter === 'low_stock'
                  ? 'All stocked products are above their low-stock alert levels.'
                  : 'No low stock alerts or pending online orders right now.'
            }
            action={
              state.dismissedCount > 0
                ? {
                    label: `Restore ${state.dismissedCount} dismissed`,
                    onPress: handleRestoreDismissed,
                  }
                : undefined
            }
          />
        }
        ListFooterComponent={
          filtered.length > 0 && state.dismissedCount > 0 ? (
            <View style={styles.footer}>
              <Button
                label={`Restore ${state.dismissedCount} dismissed alert${state.dismissedCount > 1 ? 's' : ''}`}
                variant="ghost"
                onPress={handleRestoreDismissed}
              />
            </View>
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: 12,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1 },
  dismissBtn: { padding: 4 },
  footer: { marginTop: 8, alignItems: 'center' },
});
