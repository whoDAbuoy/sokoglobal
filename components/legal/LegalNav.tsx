'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { LEGAL_DOCS } from '@/lib/legal';

export default function LegalNav() {
  const path = usePathname();
  return (
    <nav aria-label="Legal documents" className="mb-8 flex flex-wrap gap-2">
      {LEGAL_DOCS.map((d) => (
        <Link key={d.slug} href={d.href} aria-current={path === d.href ? 'page' : undefined}
          className={clsx('rounded-full border px-3.5 py-1.5 text-sm transition-colors',
            path === d.href ? 'tone-active font-medium' : 'border-neutral-200 text-neutral-600 hover:text-neutral-900')}>
          {d.title}
        </Link>
      ))}
    </nav>
  );
}
