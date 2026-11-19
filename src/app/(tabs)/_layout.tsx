import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { AppText, type IconName } from '@/ui';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TAB_META: Record<string, { label: string; icon: IconName }> = {
  online: { label: 'Online Shop', icon: 'storefront-outline' },
  index: { label: 'Home', icon: 'home-outline' },
  reports: { label: 'Reports', icon: 'chart-box-outline' },
};

function TabBar({ state, navigateToTab }: TabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {state.routes.map((route, i) => {
        const meta = TAB_META[route.name];
        if (!meta) return null;
        const focused = state.index === i;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => navigateToTab(route.key)}
            style={[
              styles.tab,
              focused && { backgroundColor: colors.primarySoft, borderTopColor: colors.primary },
            ]}
          >
            <MaterialCommunityIcons
              name={meta.icon}
              size={24}
              color={focused ? colors.text : colors.textMuted}
            />
            <AppText variant="label" bold={focused} muted={!focused}>
              {meta.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="online" />
      <Tabs.Screen name="index" />
      <Tabs.Screen name="reports" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    gap: 2,
    borderTopWidth: 3,
    borderTopColor: 'transparent',
  },
});
