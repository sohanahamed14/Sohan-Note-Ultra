import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime } from '@/lib/date';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText } from '@/ui';

type Props = {
  shopName: string;
  lastBackupAt: number | null;
  unreadNotifications: number;
  backingUp?: boolean;
  canManageSettings: boolean;
  onPressShop: () => void;
  onPressBackup: () => void;
  onPressSupport: () => void;
  onPressNotifications: () => void;
  onPressSettings: () => void;
};

export function HomeHeader({
  shopName,
  lastBackupAt,
  unreadNotifications,
  backingUp = false,
  canManageSettings,
  onPressShop,
  onPressBackup,
  onPressSupport,
  onPressNotifications,
  onPressSettings,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const backupText = lastBackupAt ? formatDateTime(lastBackupAt) : 'Never';

  return (
    <View style={[styles.bar, { backgroundColor: colors.primary, paddingTop: insets.top + 8 }]}>
      <View style={styles.left}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Switch shop: ${shopName}`}
          onPress={onPressShop}
          style={styles.shopRow}
        >
          <AppText variant="title" numberOfLines={1} style={[styles.shopName, { color: colors.onPrimary }]}>
            {shopName}
          </AppText>
          <MaterialCommunityIcons name="chevron-down" size={20} color={colors.onPrimary} />
        </Pressable>

        <View style={styles.backupRow}>
          <View style={styles.backupMeta}>
            <AppText variant="label" numberOfLines={1} style={styles.backupLabel}>
              Last backup:
            </AppText>
            <AppText variant="label" bold numberOfLines={1} style={styles.backupTime}>
              {backupText}
            </AppText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Data backup"
            onPress={onPressBackup}
            disabled={backingUp}
            style={[styles.backupPill, { backgroundColor: colors.surface }]}
          >
            {backingUp ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <AppText variant="label" bold style={{ color: colors.danger }}>
                Data backup
              </AppText>
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Support chat"
          onPress={onPressSupport}
          hitSlop={6}
          style={styles.iconBtn}
        >
          <MaterialCommunityIcons name="whatsapp" size={24} color={colors.onPrimary} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Notifications${unreadNotifications > 0 ? `, ${unreadNotifications} unread` : ''}`}
          onPress={onPressNotifications}
          hitSlop={6}
          style={styles.iconBtn}
        >
          <MaterialCommunityIcons name="bell-outline" size={24} color={colors.onPrimary} />
          {unreadNotifications > 0 ? (
            <View style={[styles.badge, { backgroundColor: colors.danger }]}>
              <AppText variant="label" bold style={styles.badgeText}>
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </AppText>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canManageSettings ? 'Settings' : 'Account'}
          onPress={onPressSettings}
          hitSlop={6}
          style={styles.iconBtn}
        >
          <MaterialCommunityIcons
            name={canManageSettings ? 'cog-outline' : 'account-circle-outline'}
            size={24}
            color={colors.onPrimary}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  left: { flex: 1, minWidth: 0, gap: 4 },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  shopName: { fontSize: 18, flexShrink: 1 },
  backupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  backupMeta: { flexShrink: 1 },
  backupLabel: { color: '#991B1B', fontSize: 11, lineHeight: 13 },
  backupTime: { color: '#991B1B', fontSize: 11, lineHeight: 14 },
  backupPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    minHeight: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  iconBtn: { padding: 6, position: 'relative' },
  badge: {
    position: 'absolute',
    top: 1,
    right: 1,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, lineHeight: 12 },
});
