'use client';

import clsx from 'clsx';

/**
 * Surface with a pointer-following glow burst on hover (see .glow-hover in
 * globals.css) and a gentle lift. Purely decorative; content stays static.
 */
export default function GlowCard({ as: Tag = 'div', className, children }: {
  as?: 'div' | 'li' | 'article' | 'section'; className?: string; children: React.ReactNode;
}) {
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--glow-x', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--glow-y', `${e.clientY - r.top}px`);
  };
  return <Tag onPointerMove={onMove} className={clsx('glow-hover card-lift', className)}>{children}</Tag>;
}
