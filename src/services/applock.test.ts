/** @jest-environment node */
import { AppError } from '@/lib/errors';
import {
  changePin,
  clearAppLock,
  disableAppLock,
  getAppLockState,
  hashPin,
  setBiometricEnabled,
  setPin,
  verifyPin,
  type LockStorage,
} from './applock';

function createMemoryStorage(): LockStorage {
  const map = new Map<string, string>();
  return {
    async getItem(k) {
      return map.get(k) ?? null;
    },
    async setItem(k, v) {
      map.set(k, v);
    },
    async deleteItem(k) {
      map.delete(k);
    },
  };
}

describe('applock service', () => {
  it('hashes PIN deterministically with salt and rejects invalid formats', async () => {
    const h1 = await hashPin('1234', 'salt-a');
    const h2 = await hashPin('1234', 'salt-a');
    const h3 = await hashPin('1234', 'salt-b');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).not.toContain('1234');

    await expect(hashPin('12', 'salt-a')).rejects.toThrow(AppError);
    await expect(hashPin('1234567', 'salt-a')).rejects.toThrow(AppError);
    await expect(hashPin('abcd', 'salt-a')).rejects.toThrow(AppError);
  });

  it('sets, verifies, changes, and disables PIN', async () => {
    const store = createMemoryStorage();
    expect(await getAppLockState(store)).toEqual({
      enabled: false,
      hasPin: false,
      biometricEnabled: false,
    });
    expect(await verifyPin('1234', store)).toBe(false);

    await setPin('4829', store);
    expect(await getAppLockState(store)).toEqual({
      enabled: true,
      hasPin: true,
      biometricEnabled: false,
    });
    expect(await verifyPin('4829', store)).toBe(true);
    expect(await verifyPin('0000', store)).toBe(false);
    expect(await verifyPin('bad', store)).toBe(false);

    await expect(changePin('0000', '9999', store)).rejects.toThrow(AppError);
    await changePin('4829', '991100', store);
    expect(await verifyPin('4829', store)).toBe(false);
    expect(await verifyPin('991100', store)).toBe(true);

    await expect(disableAppLock('1111', store)).rejects.toThrow(AppError);
    await disableAppLock('991100', store);
    expect(await getAppLockState(store)).toEqual({
      enabled: false,
      hasPin: false,
      biometricEnabled: false,
    });
  });

  it('requires PIN enabled before enabling biometric unlock and clears on clearAppLock', async () => {
    const store = createMemoryStorage();
    await expect(setBiometricEnabled(true, store)).rejects.toThrow(AppError);

    await setPin('1357', store);
    await setBiometricEnabled(true, store);
    expect((await getAppLockState(store)).biometricEnabled).toBe(true);

    await clearAppLock(store);
    expect(await getAppLockState(store)).toEqual({
      enabled: false,
      hasPin: false,
      biometricEnabled: false,
    });
  });
});
