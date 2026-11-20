import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { db, initDb } from '@/db/client';
import { isNull, eq } from 'drizzle-orm';
import { shop_members, shops } from '@/db/schema';
import { AppError, errorMessage } from '@/lib/errors';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useSession } from '@/store/session';
import { countDirtyRows, getLastBackupAt, syncNow } from './engine';
import type { SyncResult, SyncStatus } from './types';

const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000] as const;
const FOREGROUND_POLL_MS = 30_000;

type SyncStoreState = {
  status: SyncStatus;
  syncing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
  pendingCount: number;
  refreshStats: () => void;
};

export const useSyncStore = create<SyncStoreState>()((set) => ({
  status: 'idle',
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
  pendingCount: 0,
  refreshStats: () => {
    try {
      const shopId = useSession.getState().shopId ?? undefined;
      set({
        lastSyncedAt: getLastBackupAt(db),
        pendingCount: countDirtyRows(db, shopId),
      });
    } catch {
      // DB may not be migrated yet during early boot.
    }
  },
}));

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function clearTimers(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function reconcileSessionAfterSync(res: SyncResult): void {
  const session = useSession.getState();
  if (!session.user) return;
  if (session.shopId && res.revokedShops.includes(session.shopId)) {
    const nextShop = db.select().from(shops).where(isNull(shops.deleted_at)).limit(1).get();
    if (!nextShop) {
      session.setShop(null, null);
      return;
    }
    const mem = db
      .select()
      .from(shop_members)
      .where(eq(shop_members.shop_id, nextShop.id))
      .all()
      .find(
        (m) =>
          m.deleted_at === null &&
          (m.user_id === session.user?.id ||
            m.email.toLowerCase() === session.user?.email.toLowerCase()),
      );
    session.setShop(nextShop.id, mem?.role ?? 'cashier');
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = BACKOFF_MS[Math.min(retryAttempt, BACKOFF_MS.length - 1)];
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runSyncCycle({ silent: true });
  }, delay);
}

async function runSyncCycle(opts: { silent: boolean }): Promise<SyncResult | null> {
  if (!isSupabaseConfigured) {
    if (!opts.silent) {
      throw new AppError('NETWORK', 'Cloud sync is not configured');
    }
    return null;
  }
  await initDb();
  const session = useSession.getState();
  if (!session.user) {
    if (!opts.silent) {
      throw new AppError('FORBIDDEN', 'Sign in to sync');
    }
    return null;
  }

  useSyncStore.setState({ syncing: true, status: 'syncing', lastError: null });
  try {
    const res = await syncNow(db);
    retryAttempt = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    reconcileSessionAfterSync(res);
    const firstErr = res.errors[0]?.message ?? null;
    const shopId = useSession.getState().shopId ?? undefined;
    useSyncStore.setState({
      syncing: false,
      status: firstErr ? 'error' : 'idle',
      lastSyncedAt: firstErr ? getLastBackupAt(db) : res.syncedAt,
      lastError: firstErr,
      pendingCount: countDirtyRows(db, shopId),
    });
    return res;
  } catch (e) {
    const isNetwork = e instanceof AppError && e.code === 'NETWORK';
    const msg = errorMessage(e);
    const shopId = useSession.getState().shopId ?? undefined;
    useSyncStore.setState({
      syncing: false,
      status: isNetwork ? 'offline' : 'error',
      lastError: msg,
      pendingCount: countDirtyRows(db, shopId),
    });
    if (isNetwork) scheduleRetry();
    if (!opts.silent) throw e;
    return null;
  }
}

/** Debounced background sync trigger (call after local writes). */
export function scheduleSync(delayMs = 2000): void {
  useSyncStore.getState().refreshStats();
  if (!isSupabaseConfigured || !useSession.getState().user) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSyncCycle({ silent: true });
  }, delayMs);
}

/** Immediate manual sync (e.g. "Data backup" pill or Pull-to-refresh). */
export async function triggerManualSync(): Promise<SyncResult> {
  clearTimers();
  retryAttempt = 0;
  const res = await runSyncCycle({ silent: false });
  if (!res) throw new AppError('NETWORK', 'Cloud sync unavailable');
  return res;
}

let runtimeStarted = false;
let activeRuntimeCleanup: (() => void) | null = null;

function stopActiveSessionListeners(): void {
  activeRuntimeCleanup?.();
  activeRuntimeCleanup = null;
  clearTimers();
}

function startActiveSessionListeners(): void {
  stopActiveSessionListeners();
  useSyncStore.getState().refreshStats();
  const userId = useSession.getState().user?.id ?? null;
  if (!userId || !isSupabaseConfigured) return;

  void runSyncCycle({ silent: true });

  const poll = setInterval(() => {
    if (AppState.currentState === 'active') {
      void runSyncCycle({ silent: true });
    }
  }, FOREGROUND_POLL_MS);

  const appSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      retryAttempt = 0;
      void runSyncCycle({ silent: true });
    }
  });

  let removeWebOnline: (() => void) | null = null;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const onOnline = () => {
      retryAttempt = 0;
      void runSyncCycle({ silent: true });
    };
    window.addEventListener('online', onOnline);
    removeWebOnline = () => window.removeEventListener('online', onOnline);
  }

  activeRuntimeCleanup = () => {
    clearInterval(poll);
    appSub.remove();
    removeWebOnline?.();
  };
}

/**
 * Wire background sync into app startup after login (idempotent).
 * Subscribes to `useSession` user changes and attaches foreground, online, and 30s polling listeners.
 */
export function ensureSyncRuntimeStarted(): void {
  if (runtimeStarted) return;
  runtimeStarted = true;

  let prevUserId = useSession.getState().user?.id ?? null;
  if (prevUserId) {
    startActiveSessionListeners();
  } else {
    useSyncStore.getState().refreshStats();
  }

  useSession.subscribe((state) => {
    const nextUserId = state.user?.id ?? null;
    if (nextUserId === prevUserId) return;
    prevUserId = nextUserId;
    if (nextUserId) {
      startActiveSessionListeners();
    } else {
      stopActiveSessionListeners();
      useSyncStore.setState({ status: 'idle', syncing: false, lastError: null });
    }
  });
}

/** Mount foreground, online-reconnect, and 30s periodic sync polling. */
export function useSyncLifecycle(): void {
  const userId = useSession((s) => s.user?.id ?? null);

  useEffect(() => {
    ensureSyncRuntimeStarted();
    useSyncStore.getState().refreshStats();
  }, [userId]);
}
