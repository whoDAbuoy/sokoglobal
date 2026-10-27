'use client';

import clsx from 'clsx';

/**
 * "Mute this thread" switch for the portal chat and the admin support inbox. The knob is anchored
 * to the left (left-0.5) and slides right when on, so off always reads as off; the colours are fixed
 * values because the dark portal theme remaps white / neutral utilities (the knob used to turn almost
 * black on a dark track). The whole label toggles it; the button alone is the control.
 */
export default function MuteSwitch({ muted, onChange, className }: { muted: boolean; onChange: (muted: boolean) => void; className?: string }) {
  return (
    <label className={clsx('inline-flex cursor-pointer select-none items-center gap-2 text-xs text-neutral-600', className)}>
      <button type="button" role="switch" aria-checked={muted} onClick={() => onChange(!muted)}
        className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895] focus-visible:ring-offset-1',
          muted ? 'bg-[#5a9895]' : 'bg-[#8a8a8a]/45')}>
        <span aria-hidden className={clsx('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[#ffffff] shadow transition-transform duration-150',
          muted ? 'translate-x-4' : 'translate-x-0')} />
      </button>
      {muted ? 'Muted' : 'Mute this thread'}
    </label>
  );
}
