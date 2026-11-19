import { create } from 'zustand';
import type { Product } from '@/db/schema';
import { add, mulQty, roundQty } from '@/lib/money';

export type CartItem = {
  key: string;
  productId: string | null;
  name: string;
  unit: string;
  unitPrice: number;
  qty: number;
  maxStock: number | null;
  warrantyDays: number;
  imageUri: string | null;
};

type CartResult = { ok: true } | { ok: false; reason: string };

type CartState = {
  shopId: string | null;
  items: CartItem[];
  syncShop: (shopId: string | null) => void;
  addProduct: (product: Product, availableStock: number) => CartResult;
  setQty: (key: string, qty: number, availableStock?: number) => CartResult;
  setUnitPrice: (key: string, unitPrice: number) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>((set, get) => ({
  shopId: null,
  items: [],

  syncShop: (shopId) => {
    if (get().shopId !== shopId) {
      set({ shopId, items: [] });
    }
  },

  addProduct: (product, availableStock) => {
    const stock = roundQty(availableStock);
    if (stock <= 0) {
      return { ok: false, reason: `${product.name} is out of stock` };
    }
    const items = get().items;
    const existing = items.find((i) => i.productId === product.id);
    if (existing) {
      const nextQty = roundQty(existing.qty + 1);
      if (nextQty > stock) {
        return { ok: false, reason: `Only ${stock} ${product.unit} available in stock` };
      }
      set({
        items: items.map((i) =>
          i.key === existing.key ? { ...i, qty: nextQty, maxStock: stock } : i,
        ),
      });
      return { ok: true };
    }
    const initialQty = Math.min(1, stock);
    set({
      items: [
        ...items,
        {
          key: product.id,
          productId: product.id,
          name: product.name,
          unit: product.unit,
          unitPrice: product.sell_price,
          qty: roundQty(initialQty),
          maxStock: stock,
          warrantyDays: product.warranty_days,
          imageUri: product.image_uri,
        },
      ],
    });
    return { ok: true };
  },

  setQty: (key, rawQty, availableStock) => {
    const qty = roundQty(rawQty);
    if (qty <= 0) {
      set({ items: get().items.filter((i) => i.key !== key) });
      return { ok: true };
    }
    const item = get().items.find((i) => i.key === key);
    if (!item) return { ok: true };
    const limit = availableStock !== undefined ? roundQty(availableStock) : item.maxStock;
    if (limit !== null && qty > limit) {
      return { ok: false, reason: `Only ${limit} ${item.unit} available in stock` };
    }
    set({
      items: get().items.map((i) =>
        i.key === key ? { ...i, qty, maxStock: limit } : i,
      ),
    });
    return { ok: true };
  },

  setUnitPrice: (key, unitPrice) => {
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) return;
    set({
      items: get().items.map((i) => (i.key === key ? { ...i, unitPrice } : i)),
    });
  },

  removeItem: (key) => {
    set({ items: get().items.filter((i) => i.key !== key) });
  },

  clear: () => set({ items: [] }),
}));

export function getCartSummary(items: CartItem[]): {
  lineCount: number;
  totalQty: number;
  subtotal: number;
} {
  let totalQty = 0;
  let subtotal = 0;
  for (const item of items) {
    totalQty = roundQty(totalQty + item.qty);
    subtotal = add(subtotal, mulQty(item.unitPrice, item.qty));
  }
  return { lineCount: items.length, totalQty, subtotal };
}
