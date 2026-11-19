import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active, newRow, softDelete, touch } from '@/db/helpers';
import { ROLES, shop_members, shops, type Role, type ShopMember } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { can } from './permissions';

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  name: z
    .string()
    .trim()
    .max(80, 'Name is too long')
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  role: z.enum(ROLES).default('cashier'),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(ROLES),
});

export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

const ROLE_ORDER: Record<Role, number> = { owner: 0, manager: 1, cashier: 2 };

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new AppError('VALIDATION', res.error.issues[0]?.message ?? 'Invalid input');
  }
  return res.data;
}

/** Lists all active and invited members for a shop, owners first. */
export function listMembers(db: AppDb, shopId: string): ShopMember[] {
  const rows = db
    .select()
    .from(shop_members)
    .where(active(shop_members, shopId))
    .orderBy(asc(shop_members.created_at))
    .all();
  return rows.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

/** Invites an employee by email (owner only). Row syncs with status='invited', user_id=null. */
export function inviteMember(
  db: AppDb,
  shopId: string,
  actorUserId: string | null,
  actorRole: Role,
  input: InviteMemberInput,
): ShopMember {
  if (!can(actorRole, 'manageEmployees')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can invite employees');
  }
  const data = parseOrThrow(inviteMemberSchema, input);

  const existing = db
    .select({ id: shop_members.id })
    .from(shop_members)
    .where(and(active(shop_members, shopId), sql`lower(${shop_members.email}) = ${data.email}`))
    .get();
  if (existing) {
    throw new AppError('CONFLICT', 'This email is already invited or a member of this shop');
  }

  const row = newRow(shopId, actorUserId);
  db.insert(shop_members)
    .values({
      ...row,
      user_id: null,
      email: data.email,
      name: data.name,
      role: data.role,
      status: 'invited',
    })
    .run();

  const created = db.select().from(shop_members).where(eq(shop_members.id, row.id)).get();
  if (!created) throw new AppError('UNKNOWN', 'Failed to invite member');
  return created;
}

/** Changes an employee's role (owner only). Protects the primary owner and last active owner. */
export function updateMemberRole(
  db: AppDb,
  shopId: string,
  actorRole: Role,
  memberId: string,
  newRole: Role,
): ShopMember {
  if (!can(actorRole, 'manageEmployees')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can change employee roles');
  }
  const parsed = parseOrThrow(updateMemberRoleSchema, { role: newRole });

  const member = db
    .select()
    .from(shop_members)
    .where(and(active(shop_members, shopId), eq(shop_members.id, memberId)))
    .get();
  if (!member) throw new AppError('NOT_FOUND', 'Member not found');

  const shop = db
    .select({ owner_id: shops.owner_id })
    .from(shops)
    .where(and(eq(shops.id, shopId), isNull(shops.deleted_at)))
    .get();

  if (member.role === 'owner' && parsed.role !== 'owner') {
    if (shop && member.user_id === shop.owner_id) {
      throw new AppError('FORBIDDEN', 'Cannot change the primary shop owner role');
    }
    const activeOwners = db
      .select({ id: shop_members.id })
      .from(shop_members)
      .where(
        and(
          active(shop_members, shopId),
          eq(shop_members.role, 'owner'),
          eq(shop_members.status, 'active'),
        ),
      )
      .all();
    if (activeOwners.length <= 1 && activeOwners.some((o) => o.id === member.id)) {
      throw new AppError('CONFLICT', 'Shop must have at least one active owner');
    }
  }

  db.update(shop_members)
    .set({ ...touch(), role: parsed.role })
    .where(and(active(shop_members, shopId), eq(shop_members.id, memberId)))
    .run();

  const updated = db.select().from(shop_members).where(eq(shop_members.id, memberId)).get();
  if (!updated) throw new AppError('NOT_FOUND', 'Member not found');
  return updated;
}

/** Removes (soft-deletes) an employee or pending invite (owner only). Protects primary/last owner. */
export function removeMember(
  db: AppDb,
  shopId: string,
  actorRole: Role,
  memberId: string,
): void {
  if (!can(actorRole, 'manageEmployees')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can remove employees');
  }
  const member = db
    .select()
    .from(shop_members)
    .where(and(active(shop_members, shopId), eq(shop_members.id, memberId)))
    .get();
  if (!member) throw new AppError('NOT_FOUND', 'Member not found');

  const shop = db
    .select({ owner_id: shops.owner_id })
    .from(shops)
    .where(and(eq(shops.id, shopId), isNull(shops.deleted_at)))
    .get();

  if (shop && member.user_id === shop.owner_id) {
    throw new AppError('FORBIDDEN', 'Cannot remove the primary shop owner');
  }

  if (member.role === 'owner' && member.status === 'active') {
    const activeOwners = db
      .select({ id: shop_members.id })
      .from(shop_members)
      .where(
        and(
          active(shop_members, shopId),
          eq(shop_members.role, 'owner'),
          eq(shop_members.status, 'active'),
        ),
      )
      .all();
    if (activeOwners.length <= 1) {
      throw new AppError('CONFLICT', 'Shop must have at least one active owner');
    }
  }

  softDelete(db, shop_members, shopId, memberId);
}

/** Links local invited rows matching email to userId (offline/local counterpart to accept_invites RPC). */
export function acceptLocalInvites(
  db: AppDb,
  userId: string,
  email: string,
  name?: string | null,
): string[] {
  const norm = email.trim().toLowerCase();
  if (!norm) return [];

  const pending = db
    .select()
    .from(shop_members)
    .where(
      and(
        isNull(shop_members.deleted_at),
        isNull(shop_members.user_id),
        eq(shop_members.status, 'invited'),
        sql`lower(${shop_members.email}) = ${norm}`,
      ),
    )
    .all();

  if (pending.length === 0) return [];

  const shopIds: string[] = [];
  db.transaction((tx) => {
    for (const row of pending) {
      tx.update(shop_members)
        .set({
          ...touch(),
          user_id: userId,
          status: 'active',
          name: row.name ?? (name?.trim() || null),
        })
        .where(eq(shop_members.id, row.id))
        .run();
      shopIds.push(row.shop_id);
    }
  });
  return shopIds;
}
