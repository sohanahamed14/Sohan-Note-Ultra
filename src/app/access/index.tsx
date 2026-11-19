import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import type { Role, ShopMember } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import {
  inviteMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from '@/services/members';
import { can } from '@/services/permissions';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AppHeader,
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Fab,
  Loading,
  Screen,
  Segmented,
  TextField,
  useToast,
} from '@/ui';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'cashier', label: 'Cashier' },
  { value: 'manager', label: 'Manager' },
  { value: 'owner', label: 'Owner' },
];

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  cashier: 'Can create POS sales, collect customer dues, add expenses, and view stock. Cost prices, profit, reports, settings, and delete are hidden.',
  manager: 'Can manage products, stock, purchases, sales, reports, online store, and recycle bin. Cannot edit shop settings or team access.',
  owner: 'Full access to everything including shop settings, data reset, and employee permissions.',
};

export default function AppAccessScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, userId, role, shop } = useCurrentShop();

  const [members, setMembers] = useState<ShopMember[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('cashier');
  const [formError, setFormError] = useState<string | null>(null);

  const [roleTarget, setRoleTarget] = useState<ShopMember | null>(null);
  const [nextRole, setNextRole] = useState<Role>('cashier');
  const [removeTarget, setRemoveTarget] = useState<ShopMember | null>(null);

  const reload = useCallback(() => {
    if (!shopId) return;
    setMembers(listMembers(db, shopId));
  }, [shopId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (!shop || !shopId || !role) {
    return (
      <Screen header={<AppHeader title="App access" />} scroll={false}>
        <Loading label="Loading team…" />
      </Screen>
    );
  }

  if (!can(role, 'manageEmployees')) {
    return (
      <Screen header={<AppHeader title="App access" />} scroll={false}>
        <EmptyState
          icon="shield-lock-outline"
          title="Owner access required"
          message="Only shop owners can invite employees or change access roles."
        />
      </Screen>
    );
  }

  const handleInvite = () => {
    setFormError(null);
    try {
      inviteMember(db, shopId, userId, role, { email, name, role: inviteRole });
      toast.show(`Invited ${email.trim().toLowerCase()}`, 'success');
      setEmail('');
      setName('');
      setInviteRole('cashier');
      setInviteOpen(false);
      reload();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const handleChangeRole = () => {
    if (!roleTarget) return;
    try {
      updateMemberRole(db, shopId, role, roleTarget.id, nextRole);
      toast.show(`Updated role to ${nextRole}`, 'success');
      setRoleTarget(null);
      reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  const handleRemove = () => {
    if (!removeTarget) return;
    try {
      removeMember(db, shopId, role, removeTarget.id);
      toast.show('Member removed', 'info');
      setRemoveTarget(null);
      reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <Screen
      scroll={false}
      header={<AppHeader title="App access" />}
      overlay={
        <Fab
          icon="account-plus-outline"
          label="Invite employee"
          onPress={() => {
            setFormError(null);
            setInviteOpen(true);
          }}
        />
      }
    >
      <Card style={[styles.infoBanner, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="information-outline" size={20} color={colors.accent} />
        <AppText variant="secondary" style={styles.flex}>
          Invite staff using their Google email. When they sign in with that Google account, they
          automatically join {shop.name} with their role permissions.
        </AppText>
      </Card>

      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="account-group-outline"
            title="No team members yet"
            message="Tap + to invite a manager or cashier by email."
            action={{ label: 'Invite employee', onPress: () => setInviteOpen(true) }}
          />
        }
        renderItem={({ item }) => {
          const isPrimaryOwner = item.user_id !== null && item.user_id === shop.owner_id;
          const displayName = item.name?.trim() || item.email.split('@')[0] || 'Member';
          return (
            <Card style={styles.memberCard}>
              <View style={styles.memberTop}>
                <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
                  <AppText bold>{displayName.slice(0, 2).toUpperCase()}</AppText>
                </View>
                <View style={styles.flex}>
                  <View style={styles.badgesRow}>
                    <AppText bold numberOfLines={1} style={styles.flex}>
                      {displayName}
                    </AppText>
                    <Badge
                      label={item.status === 'active' ? 'Active' : 'Invited'}
                      tone={item.status === 'active' ? 'success' : 'warning'}
                    />
                  </View>
                  <AppText variant="secondary" muted numberOfLines={1}>
                    {item.email}
                  </AppText>
                </View>
              </View>

              <View style={styles.memberFooter}>
                <Badge
                  label={isPrimaryOwner ? 'PRIMARY OWNER' : item.role.toUpperCase()}
                  tone={
                    item.role === 'owner'
                      ? 'warning'
                      : item.role === 'manager'
                        ? 'success'
                        : 'neutral'
                  }
                />

                {!isPrimaryOwner ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setRoleTarget(item);
                        setNextRole(item.role);
                      }}
                      style={[styles.chipBtn, { borderColor: colors.accent }]}
                    >
                      <AppText variant="label" bold style={{ color: colors.accent }}>
                        Change role
                      </AppText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setRemoveTarget(item)}
                      style={[styles.chipBtn, { borderColor: colors.danger }]}
                    >
                      <AppText variant="label" bold style={{ color: colors.danger }}>
                        Remove
                      </AppText>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </Card>
          );
        }}
      />

      {/* Invite sheet */}
      <BottomSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite employee"
      >
        <TextField
          label="Google Email *"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (formError) setFormError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="employee@gmail.com"
        />
        <TextField
          label="Name (optional)"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Karim"
        />
        <View style={styles.roleBlock}>
          <AppText variant="secondary" muted>
            Role
          </AppText>
          <Segmented options={ROLE_OPTIONS} value={inviteRole} onChange={setInviteRole} />
          <AppText variant="label" muted>
            {ROLE_DESCRIPTIONS[inviteRole]}
          </AppText>
        </View>
        {formError ? (
          <AppText variant="secondary" style={{ color: colors.danger }}>
            {formError}
          </AppText>
        ) : null}
        <View style={styles.sheetActions}>
          <Button
            label="Cancel"
            variant="outline"
            onPress={() => setInviteOpen(false)}
            style={styles.flex}
          />
          <Button label="Send invite" onPress={handleInvite} style={styles.flex} />
        </View>
      </BottomSheet>

      {/* Change role sheet */}
      <BottomSheet
        visible={Boolean(roleTarget)}
        onClose={() => setRoleTarget(null)}
        title={`Change role — ${roleTarget?.name || roleTarget?.email || ''}`}
      >
        <Segmented options={ROLE_OPTIONS} value={nextRole} onChange={setNextRole} />
        <AppText variant="secondary" muted>
          {ROLE_DESCRIPTIONS[nextRole]}
        </AppText>
        <View style={styles.sheetActions}>
          <Button
            label="Cancel"
            variant="outline"
            onPress={() => setRoleTarget(null)}
            style={styles.flex}
          />
          <Button label="Save role" onPress={handleChangeRole} style={styles.flex} />
        </View>
      </BottomSheet>

      {/* Remove confirm */}
      <ConfirmDialog
        visible={Boolean(removeTarget)}
        title="Remove member?"
        message={`Revoke access for ${removeTarget?.email ?? ''}? They will no longer be able to view or edit ${shop.name}.`}
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  list: { gap: 10, paddingBottom: 88, flexGrow: 1 },
  memberCard: { padding: 14, gap: 10 },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  actionRow: { flexDirection: 'row', gap: 8 },
  chipBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.row,
    borderWidth: 1,
  },
  roleBlock: { gap: 8 },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
