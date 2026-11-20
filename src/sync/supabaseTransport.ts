import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { uploadShopImage } from './storage';
import type { SyncTableName, SyncTransport, TransportError, TransportResult } from './types';

function toTransportError(err: unknown): TransportError {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; status?: unknown };
    const message = typeof e.message === 'string' ? e.message : 'Sync request failed';
    const code = typeof e.code === 'string' ? e.code : undefined;
    const status = typeof e.status === 'number' ? e.status : undefined;
    const isNetwork =
      status === 0 ||
      (status !== undefined && status >= 500) ||
      /network|fetch|timeout|offline|abort/i.test(message);
    return { code, message, isNetwork };
  }
  return { message: 'Network error', isNetwork: true };
}

export function createSupabaseTransport(): SyncTransport {
  return {
    async getSessionUserId(): Promise<string | null> {
      if (!isSupabaseConfigured) return null;
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.user?.id) return null;
      return data.session.user.id;
    },

    async acceptInvites(): Promise<TransportResult<string[]>> {
      try {
        const { data, error } = await supabase.rpc('accept_invites');
        if (error) return { data: null, error: toTransportError(error) };
        const ids = Array.isArray(data) ? data.map(String) : [];
        return { data: ids, error: null };
      } catch (e) {
        return { data: null, error: toTransportError(e) };
      }
    },

    async upsert(
      table: SyncTableName,
      rows: Record<string, unknown>[],
    ): Promise<TransportError | null> {
      try {
        const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
        return error ? toTransportError(error) : null;
      } catch (e) {
        return toTransportError(e);
      }
    },

    async listAccessibleShopIds(): Promise<TransportResult<string[]>> {
      try {
        const { data, error } = await supabase.from('shops').select('id');
        if (error) return { data: null, error: toTransportError(error) };
        const ids = (data ?? [])
          .map((r) => (r && typeof r === 'object' && 'id' in r ? String(r.id) : ''))
          .filter(Boolean);
        return { data: ids, error: null };
      } catch (e) {
        return { data: null, error: toTransportError(e) };
      }
    },

    async pullPage(
      table: SyncTableName,
      shopId: string,
      afterSeq: number,
      limit: number,
    ): Promise<TransportResult<Record<string, unknown>[]>> {
      try {
        const scopeCol = table === 'shops' ? 'id' : 'shop_id';
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .eq(scopeCol, shopId)
          .gt('server_seq', afterSeq)
          .order('server_seq', { ascending: true })
          .limit(limit);
        if (error) return { data: null, error: toTransportError(error) };
        return { data: (data ?? []) as Record<string, unknown>[], error: null };
      } catch (e) {
        return { data: null, error: toTransportError(e) };
      }
    },

    uploadImage(shopId: string, localUri: string, relativePath: string): Promise<string> {
      return uploadShopImage(shopId, localUri, relativePath);
    },
  };
}
