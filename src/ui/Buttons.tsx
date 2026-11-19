import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText } from './AppText';
import type { IconName } from './icons';

export type ButtonVariant = 'primary' | 'yellow' | 'outline' | 'danger' | 'ghost';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const scheme: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.accent, fg: '#FFFFFF', border: colors.accent },
    yellow: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    outline: { bg: 'transparent', fg: colors.accent, border: colors.accent },
    danger: { bg: colors.danger, fg: '#FFFFFF', border: colors.danger },
    ghost: { bg: 'transparent', fg: colors.text, border: 'transparent' },
  };
  const c = scheme[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={[
        styles.btn,
        { backgroundColor: c.bg, borderColor: c.border, opacity: inactive ? 0.6 : 1 },
        fullWidth && styles.full,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <MaterialCommunityIcons name={icon} size={20} color={c.fg} /> : null}
          <AppText bold style={{ color: c.fg }}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

/** Large grey tile button (Buy / Sell). */
export function BigActionButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.big, { backgroundColor: colors.surfaceMuted }]}
    >
      <MaterialCommunityIcons name={icon} size={32} color={colors.accent} />
      <AppText bold>{label}</AppText>
    </Pressable>
  );
}

export function Fab({
  onPress,
  icon = 'plus',
  label,
}: {
  onPress: () => void;
  icon?: IconName;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.fab, { backgroundColor: colors.primary }]}
    >
      <MaterialCommunityIcons name={icon} size={28} color={colors.onPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  big: {
    flex: 1,
    borderRadius: radius.card,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 6,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
});
