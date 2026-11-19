import type { User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { z } from 'zod';
import type { Shop, ShopMember } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { clearAppLock } from '@/services/applock';
import { acceptLocalInvites } from '@/services/members';
import {
  cacheRemoteShopsAndMembers,
  listUserShops,
  type UserShopEntry,
} from '@/services/shop';
import { DEV_LOGIN } from '@/store/devLogin';
import { useSession, type SessionUser } from '@/store/session';
import { getOAuthRedirectUrl } from './config';
import { parseAuthCallbackUrl } from './oauth';

WebBrowser.maybeCompleteAuthSession();

const devEmailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Password is required'),
});

export function extractSessionUser(user: Pick<User, 'id' | 'email' | 'user_metadata'>): SessionUser {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    null;
  return {
    id: user.id,
    email: user.email ?? '',
    name: rawName?.trim() || null,
  };
}

/** Calls Supabase accept_invites() RPC after login. Safe no-op when unconfigured/offline. */
export async function acceptRemoteInvites(): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data, error } = await supabase.rpc('accept_invites');
    if (error || !Array.isArray(data)) return [];
    return data.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

type RemoteShopRow = Omit<Shop, 'dirty'> & { server_seq?: number; online_visits?: number };
type RemoteMemberRow = Omit<ShopMember, 'dirty'> & { server_seq?: number };

function toLocalShop(row: RemoteShopRow): Omit<Shop, 'dirty'> {
  return {
    id: row.id,
    shop_id: row.shop_id || row.id,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    deleted_at: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
    created_by: row.created_by ?? null,
    name: row.name,
    slug: row.slug ?? null,
    phone: row.phone ?? null,
    address: row.address ?? null,
    business_type: row.business_type ?? null,
    logo_uri: row.logo_uri ?? null,
    vat_percent: Number(row.vat_percent ?? 0),
    invoice_footer: row.invoice_footer ?? null,
    payment_qr_uri: row.payment_qr_uri ?? null,
    decimal_enabled: Number(row.decimal_enabled ?? 0),
    online_enabled: Number(row.online_enabled ?? 0),
    online_theme: row.online_theme ?? null,
    delivery_inside: Number(row.delivery_inside ?? 0),
    delivery_outside: Number(row.delivery_outside ?? 0),
    shop_policy: row.shop_policy ?? null,
    owner_id: row.owner_id,
    online_visits: Number(row.online_visits ?? 0),
  };
}

function toLocalMember(row: RemoteMemberRow): Omit<ShopMember, 'dirty'> {
  return {
    id: row.id,
    shop_id: row.shop_id,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    deleted_at: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
    created_by: row.created_by ?? null,
    user_id: row.user_id ?? null,
    email: row.email,
    name: row.name ?? null,
    role: row.role,
    status: row.status,
  };
}

/** Pulls user's accessible shops & memberships from Supabase and merges into local SQLite. */
export async function hydrateUserShops(db: AppDb, user: SessionUser): Promise<UserShopEntry[]> {
  await acceptRemoteInvites();
  acceptLocalInvites(db, user.id, user.email, user.name);

  if (isSupabaseConfigured) {
    try {
      const [shopsRes, membersRes] = await Promise.all([
        supabase.from('shops').select('*').is('deleted_at', null),
        supabase.from('shop_members').select('*').is('deleted_at', null),
      ]);
      const remoteShops = Array.isArray(shopsRes.data)
        ? (shopsRes.data as RemoteShopRow[]).map(toLocalShop)
        : [];
      const remoteMembers = Array.isArray(membersRes.data)
        ? (membersRes.data as RemoteMemberRow[]).map(toLocalMember)
        : [];
      if (remoteShops.length > 0 || remoteMembers.length > 0) {
        cacheRemoteShopsAndMembers(db, remoteShops, remoteMembers);
      }
    } catch {
      // Offline or transient cloud failure — proceed with local SQLite shops.
    }
  }

  return listUserShops(db, user.id, user.email);
}

/** Finalizes sign-in: accepts invites, hydrates shops, updates Zustand session. */
export async function completeSignIn(
  db: AppDb,
  user: SessionUser,
): Promise<{ user: SessionUser; shops: UserShopEntry[] }> {
  const userShops = await hydrateUserShops(db, user);
  const store = useSession.getState();
  store.setUser(user);

  const currentShopId = store.shopId;
  const preferred =
    userShops.find((entry) => entry.shop.id === currentShopId) ?? userShops[0] ?? null;

  if (preferred) {
    store.setShop(preferred.shop.id, preferred.role);
  } else {
    store.setShop(null, null);
  }

  return { user, shops: userShops };
}

/** Completes Supabase OAuth callback URL (PKCE code or implicit tokens). */
export async function completeAuthFromUrl(db: AppDb, url: string): Promise<boolean> {
  const parsed = parseAuthCallbackUrl(url);
  if (parsed.error) {
    throw new AppError('UNKNOWN', parsed.errorDescription ?? parsed.error);
  }

  if (parsed.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (error || !data.session?.user) {
      throw new AppError('NETWORK', error?.message ?? 'Failed to complete Google sign-in');
    }
    await completeSignIn(db, extractSessionUser(data.session.user));
    return true;
  }

  if (parsed.accessToken && parsed.refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    if (error || !data.session?.user) {
      throw new AppError('NETWORK', error?.message ?? 'Failed to establish session');
    }
    await completeSignIn(db, extractSessionUser(data.session.user));
    return true;
  }

  return false;
}

/** Starts Google OAuth via Supabase + expo-web-browser (native) or redirect (web). */
export async function signInWithGoogle(db: AppDb): Promise<{ completed: boolean }> {
  if (!isSupabaseConfigured) {
    throw new AppError(
      'NETWORK',
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY.',
    );
  }

  const redirectTo = getOAuthRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: Platform.OS !== 'web',
      queryParams: {
        prompt: 'select_account',
      },
    },
  });

  if (error) {
    throw new AppError('NETWORK', error.message);
  }

  if (Platform.OS === 'web') {
    return { completed: false };
  }

  if (!data?.url) {
    throw new AppError('UNKNOWN', 'Could not start Google sign-in');
  }

  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success' || !res.url) {
    return { completed: false };
  }

  const completed = await completeAuthFromUrl(db, res.url);
  return { completed };
}

/** Checks for an active Supabase session (e.g. after Web OAuth redirect) and hydrates app state. */
export async function syncExistingSupabaseSession(db: AppDb): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) return false;
  await completeSignIn(db, extractSessionUser(data.session.user));
  return true;
}

/** Dev-only email + password login (active when EXPO_PUBLIC_DEV_LOGIN=1). */
export async function signInWithEmailDev(
  db: AppDb,
  email: string,
  password: string,
): Promise<void> {
  if (!DEV_LOGIN) {
    throw new AppError('FORBIDDEN', 'Email login is only available in dev mode');
  }
  const parsed = devEmailSchema.safeParse({ email, password });
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid credentials');
  }

  if (isSupabaseConfigured) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error || !data.user) {
      throw new AppError('VALIDATION', error?.message ?? 'Invalid email or password');
    }
    await completeSignIn(db, extractSessionUser(data.user));
    return;
  }

  // Offline local dev fallback when Supabase env is unset
  const localUser: SessionUser = {
    id: `dev-${parsed.data.email}`,
    email: parsed.data.email,
    name: parsed.data.email.split('@')[0] || 'Dev User',
  };
  await completeSignIn(db, localUser);
}

/** Signs out from Supabase, clears App Lock credentials, and clears Zustand session. */
export async function signOutAll(): Promise<void> {
  if (isSupabaseConfigured) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore network sign-out failures; always clear local session.
    }
  }
  try {
    await clearAppLock();
  } catch {
    // Best-effort clear.
  }
  useSession.getState().signOut();
}
