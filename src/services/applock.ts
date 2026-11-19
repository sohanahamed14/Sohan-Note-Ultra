import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { AppError } from '@/lib/errors';

const PIN_KEY = 'sohannote_applock_pin_hash';
const ENABLED_KEY = 'sohannote_applock_enabled';
const BIOMETRIC_KEY = 'sohannote_applock_biometric';

export const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');

export type LockStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

export type AppLockState = {
  enabled: boolean;
  hasPin: boolean;
  biometricEnabled: boolean;
};

let cachedSecureAvailable: boolean | null = null;

async function isWeb(): Promise<boolean> {
  try {
    const rn = await import('react-native');
    return rn.Platform.OS === 'web';
  } catch {
    return false;
  }
}

async function canUseSecureStore(): Promise<boolean> {
  if (await isWeb()) return false;
  if (cachedSecureAvailable !== null) return cachedSecureAvailable;
  try {
    const SecureStore = await import('expo-secure-store');
    cachedSecureAvailable = await SecureStore.isAvailableAsync();
  } catch {
    cachedSecureAvailable = false;
  }
  return cachedSecureAvailable;
}

const defaultStorage: LockStorage = {
  async getItem(key) {
    if (await canUseSecureStore()) {
      const SecureStore = await import('expo-secure-store');
      return SecureStore.getItemAsync(key);
    }
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    return AsyncStorage.getItem(key);
  },
  async setItem(key, value) {
    if (await canUseSecureStore()) {
      const SecureStore = await import('expo-secure-store');
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(key, value);
  },
  async deleteItem(key) {
    if (await canUseSecureStore()) {
      const SecureStore = await import('expo-secure-store');
      await SecureStore.deleteItemAsync(key);
      return;
    }
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.removeItem(key);
  },
};

function validatePin(pin: string): string {
  const res = pinSchema.safeParse(pin);
  if (!res.success) {
    throw new AppError('VALIDATION', res.error.issues[0]?.message ?? 'Invalid PIN');
  }
  return res.data;
}

async function sha256Hex(value: string): Promise<string> {
  if (typeof Crypto.digestStringAsync === 'function') {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  }
  const encoded = new TextEncoder().encode(value);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Computes a salted SHA-256 hash of a 4-6 digit PIN. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const valid = validatePin(pin);
  if (!salt) throw new AppError('VALIDATION', 'Salt is required');
  return sha256Hex(`${salt}:${valid}`);
}

export async function getAppLockState(
  storage: LockStorage = defaultStorage,
): Promise<AppLockState> {
  const [hash, enabled, bio] = await Promise.all([
    storage.getItem(PIN_KEY),
    storage.getItem(ENABLED_KEY),
    storage.getItem(BIOMETRIC_KEY),
  ]);
  const hasPin = Boolean(hash && hash.includes(':'));
  return {
    enabled: hasPin && enabled === '1',
    hasPin,
    biometricEnabled: hasPin && enabled === '1' && bio === '1',
  };
}

/** Sets a new PIN and enables App Lock. */
export async function setPin(pin: string, storage: LockStorage = defaultStorage): Promise<void> {
  const valid = validatePin(pin);
  const salt = Crypto.randomUUID();
  const digest = await hashPin(valid, salt);
  await Promise.all([
    storage.setItem(PIN_KEY, `${salt}:${digest}`),
    storage.setItem(ENABLED_KEY, '1'),
  ]);
}

/** Verifies an entered PIN against the stored salted hash. */
export async function verifyPin(
  pin: string,
  storage: LockStorage = defaultStorage,
): Promise<boolean> {
  if (!pinSchema.safeParse(pin).success) return false;
  const stored = await storage.getItem(PIN_KEY);
  if (!stored) return false;
  const sep = stored.indexOf(':');
  if (sep <= 0) return false;
  const salt = stored.slice(0, sep);
  const expected = stored.slice(sep + 1);
  const actual = await hashPin(pin, salt);
  return timingSafeEqual(actual, expected);
}

/** Changes an existing PIN after verifying the current PIN. */
export async function changePin(
  currentPin: string,
  nextPin: string,
  storage: LockStorage = defaultStorage,
): Promise<void> {
  const ok = await verifyPin(currentPin, storage);
  if (!ok) throw new AppError('FORBIDDEN', 'Current PIN is incorrect');
  await setPin(nextPin, storage);
}

/** Disables App Lock and removes PIN after verifying current PIN. */
export async function disableAppLock(
  currentPin: string,
  storage: LockStorage = defaultStorage,
): Promise<void> {
  const ok = await verifyPin(currentPin, storage);
  if (!ok) throw new AppError('FORBIDDEN', 'Incorrect PIN');
  await clearAppLock(storage);
}

/** Clears all App Lock credentials (e.g. on sign out). */
export async function clearAppLock(storage: LockStorage = defaultStorage): Promise<void> {
  await Promise.all([
    storage.deleteItem(PIN_KEY),
    storage.deleteItem(ENABLED_KEY),
    storage.deleteItem(BIOMETRIC_KEY),
  ]);
}

export async function setBiometricEnabled(
  enabled: boolean,
  storage: LockStorage = defaultStorage,
): Promise<void> {
  if (enabled) {
    const state = await getAppLockState(storage);
    if (!state.enabled) {
      throw new AppError('VALIDATION', 'Enable PIN lock before turning on biometrics');
    }
  }
  await storage.setItem(BIOMETRIC_KEY, enabled ? '1' : '0');
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (await isWeb()) return false;
  try {
    const LocalAuthentication = await import('expo-local-authentication');
    const [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

export async function authenticateBiometric(
  promptMessage = 'Unlock Sohan Note Ultra',
): Promise<boolean> {
  if (!(await isBiometricAvailable())) return false;
  try {
    const LocalAuthentication = await import('expo-local-authentication');
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Use PIN',
      fallbackLabel: 'Use PIN',
    });
    return res.success;
  } catch {
    return false;
  }
}
