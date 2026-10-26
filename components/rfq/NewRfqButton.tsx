'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import RfqForm, { type RfqPrefill } from './RfqForm';
import type { AddonPrices } from './RfqAddOns';

/**
 * "New RFQ" glass action button + frosted modal holding the request form (hidden until asked for).
 * Opens straight away when the page was reached with a product to quote (?product=…). Closing — or
 * posting a request with nothing left to pay — dismisses the dialog and refreshes the request list.
 */
export default function NewRfqButton({ categories, prefill, addonPrices, buyerName, disabledReason, kycHref, startOpen = false }: {
  categories: { id: string; label: string }[]; prefill?: RfqPrefill; addonPrices?: AddonPrices; buyerName?: string;
  disabledReason?: string | null;
  /** Shown inside the dialog when the buyer still has to verify their business. */
  kycHref?: string | null;
  startOpen?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(startOpen);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => { setOpen(false); router.refresh(); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-full border border-snow/10 bg-snow/[0.06] px-5 py-2.5 text-sm font-medium text-neutral-900 shadow-2xl backdrop-blur-xl transition-all duration-200 hover:border-snow/25 hover:bg-snow/10 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]">
        <Plus className="h-4 w-4" aria-hidden /> New RFQ
      </button>

      <dialog ref={dialogRef} aria-labelledby="new-rfq-title" onClose={() => { if (open) close(); }}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-transparent p-0 text-neutral-900 backdrop:bg-black/60 backdrop:backdrop-blur-sm">
        <div className="sx-glass dark sellsy p-5 sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 id="new-rfq-title" className="text-xl font-semibold">New request for quote</h2>
              <p className="mt-0.5 text-sm text-neutral-500">Verified suppliers in the category send private quotes. You choose one — or none.</p>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-snow/10 hover:text-neutral-900">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {open && (
            <RfqForm bare categories={categories} prefill={prefill} addonPrices={addonPrices} buyerName={buyerName}
              disabledReason={disabledReason} onPosted={close} />
          )}
          {kycHref && <Link href={kycHref} className="btn-secondary mt-3 w-full">Verify my business</Link>}
        </div>
      </dialog>
    </>
  );
}
