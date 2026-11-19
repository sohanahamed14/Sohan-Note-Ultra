import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText } from './AppText';
import type { IconName } from './icons';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
    >
      {children}
    </View>
  );
}

export function SectionCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Card>
      {title ? (
        <AppText variant="label" muted style={styles.sectionTitle}>
          {title}
        </AppText>
      ) : null}
      {children}
    </Card>
  );
}

export type IconTileProps = {
  icon: IconName;
  label: string;
  /** Tile background tint (default accent). */
  color?: string;
  onPress?: () => void;
  badge?: number;
};

export function IconTile({ icon, label, color, onPress, badge }: IconTileProps) {
  const { colors } = useTheme();
  const tint = color ?? colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tile}
    >
      <View style={[styles.tileIcon, { backgroundColor: tint + '22' }]}>
        <MaterialCommunityIcons name={icon} size={26} color={tint} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.danger }]}>
            <AppText variant="label" style={styles.badgeText}>
              {badge > 99 ? '99+' : badge}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="label" numberOfLines={2} style={styles.tileLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** 4-column grid of IconTiles. */
export function IconGrid({ items }: { items: IconTileProps[] }) {
  return (
    <View style={styles.grid}>
      {items.map((i) => (
        <IconTile key={i.label} {...i} />
      ))}
    </View>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'success' | 'danger' | 'warning' | 'neutral';
}) {
  const { colors } = useTheme();
  const map = {
    success: colors.success,
    danger: colors.danger,
    warning: colors.primary,
    neutral: colors.textMuted,
  };
  return (
    <View style={[styles.pill, { backgroundColor: map[tone] + '26' }]}>
      <AppText variant="label" bold style={{ color: tone === 'warning' ? colors.text : map[tone] }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.card, padding: 12 },
  sectionTitle: { marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '25%', alignItems: 'center', paddingVertical: 8, gap: 6 },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11 },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
});
