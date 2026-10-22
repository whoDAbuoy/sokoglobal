'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { EMOJI_GROUPS } from '@/lib/emoji';

/** Emoji popover for the chat composer. Picking an emoji calls onPick and keeps the popover open for more. */
export default function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={disabled} aria-expanded={open} aria-controls={id} aria-label="Insert emoji"
        className="grid h-9 w-9 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50">
        <Smile className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div id={id} role="dialog" aria-label="Emoji"
          className="absolute bottom-11 left-0 z-20 max-h-64 w-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 shadow-overlay">
          {EMOJI_GROUPS.map((g) => (
            <div key={g.label} className="mb-1">
              <p className="px-1 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{g.label}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {g.emojis.map((e) => (
                  <button key={e} type="button" onClick={() => onPick(e)} aria-label={`Insert ${e}`}
                    className="grid h-8 w-8 place-items-center rounded-md text-lg hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
