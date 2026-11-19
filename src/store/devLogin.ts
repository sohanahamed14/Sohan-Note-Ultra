import { db } from '@/db/client';
import { newRow } from '@/db/helpers';
import { shop_members, shops } from '@/db/schema';
import { useSession } from './session';

export const DEV_LOGIN = process.env.EXPO_PUBLIC_DEV_LOGIN === '1';

const DEV_USER = { id: 'dev-user', email: 'dev@local.test', name: 'Dev Owner' };

/** Dev only (EXPO_PUBLIC_DEV_LOGIN=1): sign in locally and create a demo shop if none exists. */
export function ensureDevSession(): void {
  const s = useSession.getState();
  if (s.user && s.shopId) return;
  const existing = db.select().from(shops).limit(1).all()[0];
  let shopId = existing?.id;
  if (!shopId) {
    const row = newRow('pending', DEV_USER.id);
    shopId = row.id;
    db.transaction((tx) => {
      tx.insert(shops)
        .values({ ...row, shop_id: row.id, name: 'Dev Shop', owner_id: DEV_USER.id })
        .run();
      tx.insert(shop_members)
        .values({
          ...newRow(row.id, DEV_USER.id),
          email: DEV_USER.email,
          name: DEV_USER.name,
          user_id: DEV_USER.id,
          role: 'owner',
          status: 'active',
        })
        .run();
    });
  }
  s.setUser(DEV_USER);
  s.setShop(shopId, 'owner');
}
