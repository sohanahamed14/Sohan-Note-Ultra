import { Pressable, StyleSheet, View } from 'react-native';
import { formatTaka } from '@/lib/money';
import type { DashboardPeriod, DashboardStats } from '@/services/dashboard';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText, Card, Divider } from '@/ui';

type Props = {
  stats: DashboardStats;
  period: DashboardPeriod;
  decimal: boolean;
  onChangePeriod: (p: DashboardPeriod) => void;
  onPressBalance?: () => void;
  onPressSales: () => void;
  onPressExpense: () => void;
  onPressDue: () => void;
  onPressStock: () => void;
};

export function StatsCard({
  stats,
  period,
  decimal,
  onChangePeriod,
  onPressBalance,
  onPressSales,
  onPressExpense,
  onPressDue,
  onPressStock,
}: Props) {
  const { colors } = useTheme();
  const isDay = period === 'day';

  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole={onPressBalance ? 'button' : undefined}
          onPress={onPressBalance}
          disabled={!onPressBalance}
          style={styles.metricCol}
        >
          <AppText variant="label" muted numberOfLines={1}>
            Balance
          </AppText>
          <AppText
            bold
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              styles.metricVal,
              {
                color:
                  stats.cashBalance === null
                    ? colors.textMuted
                    : stats.cashBalance < 0
                      ? colors.danger
                      : colors.text,
              },
            ]}
          >
            {stats.cashBalance === null ? '—' : formatTaka(stats.cashBalance, decimal)}
          </AppText>
        </Pressable>

        <Pressable accessibilityRole="button" onPress={onPressSales} style={styles.metricCol}>
          <AppText variant="label" muted numberOfLines={1}>
            {isDay ? "Today's sales" : "Month's sales"}
          </AppText>
          <AppText bold numberOfLines={1} adjustsFontSizeToFit style={styles.metricVal}>
            {formatTaka(stats.salesTotal, decimal)}
          </AppText>
        </Pressable>

        <View style={[styles.toggle, { backgroundColor: colors.surfaceMuted }]}>
          {(['day', 'month'] as const).map((opt) => {
            const active = period === opt;
            return (
              <Pressable
                key={opt}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onChangePeriod(opt)}
                style={[styles.toggleBtn, active && { backgroundColor: colors.accent }]}
              >
                <AppText
                  variant="label"
                  bold={active}
                  style={{ color: active ? '#FFFFFF' : colors.text }}
                >
                  {opt === 'day' ? 'Day' : 'Month'}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Divider />

      <View style={styles.bottomRow}>
        <Pressable accessibilityRole="button" onPress={onPressExpense} style={styles.bottomCol}>
          <AppText variant="label" muted numberOfLines={1}>
            {isDay ? "Today's expense" : "Month's expense"}
          </AppText>
          <AppText bold numberOfLines={1} adjustsFontSizeToFit style={styles.subVal}>
            {formatTaka(stats.expenseTotal, decimal)}
          </AppText>
        </Pressable>

        <Pressable accessibilityRole="button" onPress={onPressDue} style={styles.dueCol}>
          <AppText variant="label" muted style={styles.center}>
            Due
          </AppText>
          <View style={styles.dueSplit}>
            <View style={styles.dueHalf}>
              <AppText variant="label" style={[styles.tinyLabel, { color: colors.danger }]}>
                Given
              </AppText>
              <AppText
                variant="label"
                bold
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ color: colors.danger }}
              >
                {formatTaka(stats.dueReceivable, decimal)}
              </AppText>
            </View>
            <View style={styles.dueHalf}>
              <AppText variant="label" style={[styles.tinyLabel, { color: colors.success }]}>
                Taken
              </AppText>
              <AppText
                variant="label"
                bold
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ color: colors.success }}
              >
                {formatTaka(stats.duePayable, decimal)}
              </AppText>
            </View>
          </View>
        </Pressable>

        <Pressable accessibilityRole="button" onPress={onPressStock} style={styles.stockCol}>
          <AppText variant="label" muted numberOfLines={1}>
            Stock count
          </AppText>
          <AppText bold numberOfLines={1} adjustsFontSizeToFit style={styles.subVal}>
            {stats.stockCount}
          </AppText>
          {stats.lowStockCount > 0 ? (
            <AppText variant="label" style={[styles.tinyLabel, { color: colors.danger }]}>
              {stats.lowStockCount} low
            </AppText>
          ) : null}
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricCol: { flex: 1, minWidth: 0, gap: 2 },
  metricVal: { fontSize: 15 },
  toggle: {
    flexDirection: 'row',
    borderRadius: radius.row,
    padding: 2,
    flexShrink: 0,
  },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.row - 1,
  },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  bottomCol: { flex: 1, minWidth: 0, gap: 2 },
  dueCol: { flex: 1.45, minWidth: 0, gap: 2 },
  dueSplit: { flexDirection: 'row', gap: 4 },
  dueHalf: { flex: 1, alignItems: 'center', minWidth: 0 },
  stockCol: { flex: 0.85, alignItems: 'flex-end', minWidth: 0, gap: 2 },
  subVal: { fontSize: 14 },
  tinyLabel: { fontSize: 11, lineHeight: 13 },
  center: { textAlign: 'center' },
});
