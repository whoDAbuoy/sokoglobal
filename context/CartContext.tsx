'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProductCategory } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';

export const CART_MAX_ITEMS = 10;   // mirrors create_cart_checkout()

/** A Trial Batch in the cart. Display snapshot only — prices are re-read server-side at checkout. */
export interface CartItem {
  productId: string;
  title: string;
  supplierName: string;
  imageUrl: string | null;
  category: ProductCategory;
  landedCostCents: number;
}

interface CartState {
  items: CartItem[];
  subtotalCents: number;
  has: (productId: string) => boolean;
  /** 'full' when the cart already holds CART_MAX_ITEMS. */
  add: (item: CartItem) => 'added' | 'exists' | 'full';
  remove: (productId: string) => void;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CartContext = createContext<CartState | undefined>(undefined);
const storageKey = (userId: string | undefined) => `sokoglobal.cart.v1:${userId ?? 'guest'}`;

function read(key: string): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? (parsed as CartItem[]).filter((i) => i && typeof i.productId === 'string').slice(0, CART_MAX_ITEMS)
      : [];
  } catch { return []; }
}

/**
 * Per-user cart persisted in localStorage (survives reloads, syncs across
 * tabs). Only a browsing convenience: checkout sends product ids and Postgres
 * prices them, so a tampered cart can't change what anyone pays.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const key = storageKey(user?.id);
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => { setItems(read(key)); }, [key]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === key) setItems(read(key)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  const persist = useCallback((next: CartItem[]) => {
    setItems(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode: in-memory only */ }
  }, [key]);

  const value = useMemo<CartState>(() => ({
    items,
    subtotalCents: items.reduce((sum, i) => sum + i.landedCostCents, 0),
    has: (id) => items.some((i) => i.productId === id),
    add: (item) => {
      if (items.some((i) => i.productId === item.productId)) return 'exists';
      if (items.length >= CART_MAX_ITEMS) return 'full';
      persist([...items, item]);
      return 'added';
    },
    remove: (id) => persist(items.filter((i) => i.productId !== id)),
    clear: () => persist([]),
    open,
    setOpen,
  }), [items, open, persist]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
