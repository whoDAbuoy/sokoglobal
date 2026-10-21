import { redirect } from 'next/navigation';

/** Supplier pages live under /supplier; this path forwards there. */
export default function SupplierOrdersAlias() {
  redirect('/supplier/orders');
}
