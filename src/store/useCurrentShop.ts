import { and, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { expoDb } from '@/db/client';
import { shops, type Role, type Shop } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { useSession } from './session';

export type CurrentShop = {
  shopId: string | null;
  userId: string | null;
  role: Role | null;
  shop: Shop | null;
  /** Throws AppError(FORBIDDEN) when no shop is selected; use in handlers. */
  requireShop: () => { shopId: string; userId: string | null; role: Role };
};

export function useCurrentShop(): CurrentShop {
  const shopId = useSession((s) => s.shopId);
  const role = useSession((s) => s.role);
  const userId = useSession((s) => s.user?.id ?? null);
  const { data } = useLiveQuery(
    expoDb
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId ?? ''), isNull(shops.deleted_at))),
    [shopId],
  );
  return {
    shopId,
    userId,
    role,
    shop: data[0] ?? null,
    requireShop: () => {
      if (!shopId || !role) throw new AppError('FORBIDDEN', 'No shop selected');
      return { shopId, userId, role };
    },
  };
}
