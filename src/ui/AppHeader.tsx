import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { AppText } from './AppText';
import type { IconName } from './icons';

export type HeaderAction = { icon: IconName; label: string; onPress: () => void };

type Props = {
  title: string;
  /** Show back arrow (default true). Home variant never shows it. */
  back?: boolean;
  right?: HeaderAction[];
  variant?: 'default' | 'home';
  /** Home variant: small line under the title (e.g. last backup). */
  subtitle?: ReactNode;
  /** Home variant: white pill button (e.g. Data backup). */
  pill?: { label: string; onPress: () => void };
};

export function AppHeader({
  title,
  back = true,
  right = [],
  variant = 'default',
  subtitle,
  pill,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const home = variant === 'home';
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={[styles.bar, { backgroundColor: colors.primary, paddingTop: insets.top + 8 }]}>
      {back && !home ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          hitSlop={8}
          style={styles.icon}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.onPrimary} />
        </Pressable>
      ) : null}
      <View style={styles.titleWrap}>
        <AppText variant="title" numberOfLines={1} style={{ color: colors.onPrimary }}>
          {title}
        </AppText>
        {home && subtitle ? <View style={styles.sub}>{subtitle}</View> : null}
      </View>
      {home && pill ? (
        <Pressable
          accessibilityRole="button"
          onPress={pill.onPress}
          style={[styles.pill, { backgroundColor: colors.surface }]}
        >
          <AppText variant="label" style={{ color: colors.accent }}>
            {pill.label}
          </AppText>
        </Pressable>
      ) : null}
      {right.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          onPress={a.onPress}
          hitSlop={8}
          style={styles.icon}
        >
          <MaterialCommunityIcons name={a.icon} size={24} color={colors.onPrimary} />
        </Pressable>
      ))}
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
  titleWrap: { flex: 1 },
  sub: { marginTop: 2 },
  icon: { padding: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 24 },
});
