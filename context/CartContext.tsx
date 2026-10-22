'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProductCategory } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { MAX_CART_LINES, clampQuantity, normalizeStoredCart } from '@/lib/cart';

export const CART_MAX_ITEMS = MAX_CART_LINES;   // lines; mirrors create_cart_checkout()

/** A cart line. Display snapshot only — prices are re-read server-side at checkout. */
export interface CartItem {
  productId: string;
  title: string;
  supplierName: string;
  imageUrl: string | null;
  category: ProductCategory;
  /** Guaranteed Landed Cost of ONE Trial Batch. */
  landedCostCents: number;
  /** Number of Trial Batches (1–20). */
  quantity: number;
}

interface CartState {
  items: CartItem[];
  /** Total Trial Batches across all lines. */
  batchCount: number;
  subtotalCents: number;
  has: (productId: string) => boolean;
  quantityOf: (productId: string) => number;
  /** 'full' when the cart already holds CART_MAX_ITEMS lines. Adding an existing line adds to its quantity. */
  add: (item: Omit<CartItem, 'quantity'>, quantity?: number) => 'added' | 'updated' | 'full';
  setQuantity: (productId: string, quantity: number) => void;
  /** Quick reorder: put each line in the cart at exactly its quantity (existing lines are set, not added to). */
  reorder: (lines: CartItem[]) => { added: number; updated: number; skipped: number };
  remove: (productId: string) => void;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CartContext = createContext<CartState | undefined>(undefined);
const storageKey = (userId: string | undefined) => `sokoglobal.cart.v1:${userId ?? 'guest'}`;

function read(key: string): CartItem[] {
  try { return normalizeStoredCart<CartItem>(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return []; }
}

/**
 * Per-user cart persisted in localStorage (survives reloads, syncs across
 * tabs). Only a browsing convenience: checkout sends product ids + quantities
 * and Postgres prices them, so a tampered cart can't change what anyone pays.
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
    batchCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotalCents: items.reduce((sum, i) => sum + i.landedCostCents * i.quantity, 0),
    has: (id) => items.some((i) => i.productId === id),
    quantityOf: (id) => items.find((i) => i.productId === id)?.quantity ?? 0,
    add: (item, quantity = 1) => {
      const existing = items.find((i) => i.productId === item.productId);
      if (existing) {
        persist(items.map((i) => (i.productId === item.productId ? { ...i, quantity: clampQuantity(i.quantity + quantity) } : i)));
        return 'updated';
      }
      if (items.length >= CART_MAX_ITEMS) return 'full';
      persist([...items, { ...item, quantity: clampQuantity(quantity) }]);
      return 'added';
    },
    setQuantity: (id, quantity) => persist(items.map((i) => (i.productId === id ? { ...i, quantity: clampQuantity(quantity) } : i))),
    reorder: (lines) => {
      const next = [...items];
      const r = { added: 0, updated: 0, skipped: 0 };
      for (const line of lines) {
        const at = next.findIndex((i) => i.productId === line.productId);
        if (at >= 0) { next[at] = { ...next[at], quantity: clampQuantity(line.quantity) }; r.updated += 1; }
        else if (next.length < CART_MAX_ITEMS) { next.push({ ...line, quantity: clampQuantity(line.quantity) }); r.added += 1; }
        else r.skipped += 1;
      }
      persist(next);
      return r;
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
