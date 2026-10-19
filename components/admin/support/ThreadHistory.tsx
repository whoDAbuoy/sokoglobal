'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

/** Collapsible "N earlier messages" block; the server renders the messages, this only toggles them. */
export default function ThreadHistory({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="border-b border-neutral-200">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-xs font-medium text-neutral-600 hover:text-neutral-900">
        <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', open ? 'rotate-0' : '-rotate-90')} aria-hidden />
        {open ? 'Hide earlier messages' : `${count} earlier message${count === 1 ? '' : 's'}`}
      </button>
      {open && <div className="animate-fade-in">{children}</div>}
    </div>
  );
}
