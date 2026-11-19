import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { AppHeader } from './AppHeader';
import { AppText } from './AppText';
import { Button } from './Buttons';
import type { IconName } from './icons';
import { Screen } from './Screen';

export function EmptyState({
  icon = 'tray',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <MaterialCommunityIcons name={icon} size={48} color={colors.textMuted} />
      <AppText bold>{title}</AppText>
      {message ? (
        <AppText variant="secondary" muted style={styles.text}>
          {message}
        </AppText>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? (
        <AppText variant="secondary" muted>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

/** Placeholder body for routes that are not built yet. */
export function ComingSoon({ title, back = true }: { title: string; back?: boolean }) {
  return (
    <Screen header={<AppHeader title={title} back={back} />} scroll={false}>
      <EmptyState icon="hammer-wrench" title="Coming soon" message={`${title} is not built yet.`} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  text: { textAlign: 'center' },
});
