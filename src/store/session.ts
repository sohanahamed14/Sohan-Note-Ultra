import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Role } from '@/db/schema';

export type SessionUser = { id: string; email: string; name: string | null };

type SessionState = {
  user: SessionUser | null;
  shopId: string | null;
  role: Role | null;
  hydrated: boolean;
  setUser: (user: SessionUser | null) => void;
  setShop: (shopId: string | null, role: Role | null) => void;
  signOut: () => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      shopId: null,
      role: null,
      hydrated: false,
      setUser: (user) => set({ user }),
      setShop: (shopId, role) => set({ shopId, role }),
      signOut: () => set({ user: null, shopId: null, role: null }),
    }),
    {
      name: 'session',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ user: s.user, shopId: s.shopId, role: s.role }),
      onRehydrateStorage: () => () => useSession.setState({ hydrated: true }),
    },
  ),
);
