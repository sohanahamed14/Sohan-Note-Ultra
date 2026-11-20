import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Role, Shop } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import {
  ONLINE_THEMES,
  getOnlineTheme,
  updateOnlineTheme,
  type OnlineThemeId,
} from '@/services/online';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { scheduleSync } from '@/sync';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppHeader,
  AppText,
  Badge,
  Button,
  Card,
  EmptyState,
  Loading,
  Screen,
  useToast,
} from '@/ui';

function ThemesForm({
  shop,
  shopId,
  role,
}: {
  shop: Shop;
  shopId: string;
  role: Role;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [selected, setSelected] = useState<OnlineThemeId>(getOnlineTheme(shop.online_theme).id);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    try {
      updateOnlineTheme(db, { shopId, role, online_theme: selected });
      scheduleSync(500);
      toast.show('Storefront theme saved', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Themes" />}>
      <AppText variant="secondary" muted>
        Pick a color theme for your public storefront at /s/{shop.slug ?? 'your-shop'}.
      </AppText>

      <View style={styles.list}>
        {ONLINE_THEMES.map((theme) => {
          const isSelected = selected === theme.id;
          return (
            <Pressable
              key={theme.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => setSelected(theme.id)}
            >
              <Card
                style={[
                  styles.themeCard,
                  isSelected && { borderColor: colors.accent, borderWidth: 2 },
                ]}
              >
                {/* Mini storefront header + cards mockup */}
                <View style={[styles.previewBox, { backgroundColor: theme.bg }]}>
                  <View style={[styles.previewHeader, { backgroundColor: theme.primary }]}>
                    <AppText variant="label" bold style={{ color: theme.onPrimary }}>
                      {shop.name}
                    </AppText>
                    <View style={[styles.previewPill, { backgroundColor: theme.accent }]}>
                      <AppText variant="label" style={{ color: '#FFFFFF', fontSize: 10 }}>
                        Order
                      </AppText>
                    </View>
                  </View>
                  <View style={styles.previewBody}>
                    <View style={[styles.previewTile, { backgroundColor: theme.surface }]}>
                      <View style={[styles.swatchBar, { backgroundColor: theme.primary + '33' }]} />
                      <View style={[styles.swatchLine, { backgroundColor: theme.accent }]} />
                    </View>
                    <View style={[styles.previewTile, { backgroundColor: theme.surface }]}>
                      <View style={[styles.swatchBar, { backgroundColor: theme.primary + '33' }]} />
                      <View style={[styles.swatchLine, { backgroundColor: theme.accent }]} />
                    </View>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.flex}>
                    <View style={styles.titleRow}>
                      <AppText bold>{theme.name}</AppText>
                      {isSelected ? <Badge label="Selected" tone="success" /> : null}
                    </View>
                    <AppText variant="label" muted>
                      {theme.description}
                    </AppText>
                  </View>
                  <MaterialCommunityIcons
                    name={isSelected ? 'check-circle' : 'circle-outline'}
                    size={24}
                    color={isSelected ? colors.accent : colors.textMuted}
                  />
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <Button
        label="Apply Theme"
        icon="palette-outline"
        loading={saving}
        fullWidth
        onPress={handleSave}
      />
    </Screen>
  );
}

export default function ThemesScreen() {
  const { shopId, role, shop } = useCurrentShop();
  const allowed = can(role, 'manageOnline');

  if (!allowed) {
    return (
      <Screen header={<AppHeader title="Themes" />} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Permission required"
          message="Only owners and managers can change the storefront theme."
        />
      </Screen>
    );
  }

  if (!shop || !shopId || !role) {
    return (
      <Screen header={<AppHeader title="Themes" />} scroll={false}>
        <Loading label="Loading…" />
      </Screen>
    );
  }

  return <ThemesForm key={shop.id} shop={shop} shopId={shopId} role={role} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 12 },
  themeCard: { gap: 10 },
  previewBox: {
    borderRadius: radius.row,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  previewPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  previewBody: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
  },
  previewTile: {
    flex: 1,
    borderRadius: 6,
    padding: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  swatchBar: { height: 22, borderRadius: 4 },
  swatchLine: { height: 6, width: '60%', borderRadius: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
