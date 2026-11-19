/** @jest-environment node */
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import {
  acceptLocalInvites,
  inviteMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from './members';
import { createShop } from './shop';

const OWNER = { userId: 'u-owner', email: 'owner@shop.test', name: 'Owner' };

describe('members service', () => {
  it('invites employee by email and lists sorted by role', () => {
    const db = createTestDb();
    const shop = createShop(db, { name: 'My Shop' }, OWNER);

    const cashier = inviteMember(db, shop.id, OWNER.userId, 'owner', {
      email: 'Cashier@Shop.Test',
      name: 'Rafi',
      role: 'cashier',
    });
    expect(cashier).toMatchObject({
      email: 'cashier@shop.test',
      name: 'Rafi',
      role: 'cashier',
      status: 'invited',
      user_id: null,
      dirty: 1,
    });

    const mgr = inviteMember(db, shop.id, OWNER.userId, 'owner', {
      email: 'mgr@shop.test',
      role: 'manager',
    });

    const list = listMembers(db, shop.id);
    expect(list.map((m) => m.role)).toEqual(['owner', 'manager', 'cashier']);
    expect(mgr.name).toBeNull();
  });

  it('enforces owner-only permissions, email validation, and duplicate prevention', () => {
    const db = createTestDb();
    const shop = createShop(db, { name: 'Perm Shop' }, OWNER);

    expect(() =>
      inviteMember(db, shop.id, 'u-mgr', 'manager', { email: 'a@b.com', role: 'cashier' }),
    ).toThrow(AppError);
    expect(() =>
      inviteMember(db, shop.id, 'u-cash', 'cashier', { email: 'a@b.com', role: 'cashier' }),
    ).toThrow(AppError);
    expect(() =>
      inviteMember(db, shop.id, OWNER.userId, 'owner', { email: 'not-an-email', role: 'cashier' }),
    ).toThrow(AppError);

    // Owner's own email already present
    expect(() =>
      inviteMember(db, shop.id, OWNER.userId, 'owner', { email: 'OWNER@SHOP.TEST', role: 'cashier' }),
    ).toThrow(AppError);

    inviteMember(db, shop.id, OWNER.userId, 'owner', { email: 'emp@shop.test', role: 'cashier' });
    expect(() =>
      inviteMember(db, shop.id, OWNER.userId, 'owner', { email: 'EMP@shop.test', role: 'manager' }),
    ).toThrow(AppError);
  });

  it('changes roles and protects the primary shop owner', () => {
    const db = createTestDb();
    const shop = createShop(db, { name: 'Role Shop' }, OWNER);
    const emp = inviteMember(db, shop.id, OWNER.userId, 'owner', {
      email: 'emp@shop.test',
      role: 'cashier',
    });

    const promoted = updateMemberRole(db, shop.id, 'owner', emp.id, 'manager');
    expect(promoted.role).toBe('manager');

    // Non-owner cannot update roles
    expect(() => updateMemberRole(db, shop.id, 'manager', emp.id, 'cashier')).toThrow(AppError);

    // Primary owner cannot be demoted
    const ownerRow = listMembers(db, shop.id).find((m) => m.user_id === OWNER.userId);
    expect(ownerRow).toBeDefined();
    expect(() => updateMemberRole(db, shop.id, 'owner', ownerRow?.id ?? '', 'manager')).toThrow(
      AppError,
    );

    // Missing member → NOT_FOUND
    expect(() => updateMemberRole(db, shop.id, 'owner', 'missing-id', 'cashier')).toThrow(AppError);
  });

  it('removes employee (soft-delete) and blocks removing primary owner', () => {
    const db = createTestDb();
    const shop = createShop(db, { name: 'Remove Shop' }, OWNER);
    const emp = inviteMember(db, shop.id, OWNER.userId, 'owner', {
      email: 'emp@shop.test',
      role: 'cashier',
    });

    expect(() => removeMember(db, shop.id, 'cashier', emp.id)).toThrow(AppError);

    const ownerRow = listMembers(db, shop.id).find((m) => m.user_id === OWNER.userId);
    expect(() => removeMember(db, shop.id, 'owner', ownerRow?.id ?? '')).toThrow(AppError);

    removeMember(db, shop.id, 'owner', emp.id);
    expect(listMembers(db, shop.id)).toHaveLength(1);

    // Re-inviting previously removed email works
    const reinvited = inviteMember(db, shop.id, OWNER.userId, 'owner', {
      email: 'emp@shop.test',
      role: 'manager',
    });
    expect(reinvited.role).toBe('manager');
  });

  it('acceptLocalInvites activates matching invited rows by email', () => {
    const db = createTestDb();
    const shop = createShop(db, { name: 'Invite Shop' }, OWNER);
    inviteMember(db, shop.id, OWNER.userId, 'owner', {
      email: 'worker@gmail.com',
      role: 'cashier',
    });

    const linked = acceptLocalInvites(db, 'u-worker', 'WORKER@gmail.com', 'Worker Name');
    expect(linked).toEqual([shop.id]);

    const member = listMembers(db, shop.id).find((m) => m.email === 'worker@gmail.com');
    expect(member).toMatchObject({
      user_id: 'u-worker',
      status: 'active',
      name: 'Worker Name',
    });

    // Running again is a no-op
    expect(acceptLocalInvites(db, 'u-worker', 'worker@gmail.com')).toEqual([]);
  });
});
