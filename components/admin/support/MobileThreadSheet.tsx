'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery, useVisualViewport } from '@/hooks/useViewport';

/**
 * Phones (< 768 px): an open support conversation becomes a full-screen panel above everything, like the
 * buyer / supplier chat (components/chat/MessagingHub.tsx). data-chat-fullscreen hides the bottom dock and
 * locks page scroll (app/globals.css), and the panel is sized to the visual viewport so the reply box stays
 * above the on-screen keyboard. It opens scrolled to the newest message. Wider screens (and the first
 * render, before the media query is known) render the children in place.
 */
export default function MobileThreadSheet({ open, children }: { open: boolean; children: React.ReactNode }) {
  const phone = useMediaQuery('(max-width: 767px)');
  const fullScreen = phone && open;
  const vv = useVisualViewport(fullScreen);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!fullScreen) return;
    const scroller = ref.current?.querySelector<HTMLElement>('[data-thread-scroll]');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [fullScreen]);

  if (!fullScreen) return <>{children}</>;
  return createPortal(
    <section ref={ref} data-chat-fullscreen aria-label="Conversation"
      style={vv ? { top: vv.offsetTop, height: vv.height } : undefined}
      className="dark sellsy fixed inset-x-0 top-0 z-[60] flex h-[100dvh] flex-col bg-[#050505] pt-[env(safe-area-inset-top)] text-neutral-900 motion-safe:animate-slide-in-right">
      {children}
    </section>,
    document.body,
  );
}
