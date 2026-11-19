import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { listUserShops, type UserShopEntry } from '@/services/shop';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme';
import { AppHeader, AppText, Badge, Button, Card, EmptyState, Screen, useToast } from '@/ui';

export default function ShopsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const user = useSession((s) => s.user);
  const currentShopId = useSession((s) => s.shopId);
  const setShop = useSession((s) => s.setShop);

  const [entries, setEntries] = useState<UserShopEntry[]>([]);

  const reload = useCallback(() => {
    if (!user) {
      setEntries([]);
      return;
    }
    setEntries(listUserShops(db, user.id, user.email));
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const handleSelect = (entry: UserShopEntry) => {
    setShop(entry.shop.id, entry.role);
    toast.show(`Switched to ${entry.shop.name}`, 'success');
    router.replace('/');
  };

  const openCreate = () => {
    router.push('/shops/new');
  };

  return (
    <Screen
      scroll={false}
      header={
        <AppHeader
          title="My shops"
          right={[{ icon: 'plus', label: 'Create shop', onPress: openCreate }]}
        />
      }
    >
      <FlatList
        data={entries}
        keyExtractor={(item) => item.shop.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="store-outline"
            title="No shops yet"
            message="Create your first shop to start tracking sales, stock, and dues."
            action={{ label: 'Create new shop', onPress: openCreate }}
          />
        }
        renderItem={({ item }) => {
          const isActive = item.shop.id === currentShopId;
          const initials = item.shop.name.trim().slice(0, 2).toUpperCase() || 'SN';
          return (
            <Pressable accessibilityRole="button" onPress={() => handleSelect(item)}>
              <Card
                style={[
                  styles.shopCard,
                  isActive && { borderColor: colors.accent, borderWidth: 2 },
                ]}
              >
                <View style={styles.row}>
                  {item.shop.logo_uri ? (
                    <Image
                      source={{ uri: item.shop.logo_uri }}
                      style={styles.avatar}
                      contentFit="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.avatar,
                        { backgroundColor: isActive ? colors.primary : colors.surfaceMuted },
                      ]}
                    >
                      <AppText bold style={{ color: isActive ? colors.onPrimary : colors.text }}>
                        {initials}
                      </AppText>
                    </View>
                  )}

                  <View style={styles.info}>
                    <View style={styles.titleRow}>
                      <AppText bold numberOfLines={1} style={styles.flex}>
                        {item.shop.name}
                      </AppText>
                      <Badge
                        label={item.role.toUpperCase()}
                        tone={
                          item.role === 'owner'
                            ? 'warning'
                            : item.role === 'manager'
                              ? 'success'
                              : 'neutral'
                        }
                      />
                    </View>
                    {item.shop.business_type || item.shop.phone ? (
                      <AppText variant="secondary" muted numberOfLines={1}>
                        {[item.shop.business_type, item.shop.phone].filter(Boolean).join(' · ')}
                      </AppText>
                    ) : null}
                    {item.shop.address ? (
                      <AppText variant="label" muted numberOfLines={1}>
                        {item.shop.address}
                      </AppText>
                    ) : null}
                  </View>

                  <MaterialCommunityIcons
                    name={isActive ? 'check-circle' : 'chevron-right'}
                    size={24}
                    color={isActive ? colors.accent : colors.textMuted}
                  />
                </View>
              </Card>
            </Pressable>
          );
        }}
        ListFooterComponent={
          entries.length > 0 ? (
            <View style={styles.footer}>
              <Button
                label="Create new shop"
                variant="yellow"
                icon="store-plus-outline"
                onPress={openCreate}
                fullWidth
              />
            </View>
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, flexGrow: 1, paddingBottom: 24 },
  shopCard: { padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  footer: { paddingTop: 12 },
});
