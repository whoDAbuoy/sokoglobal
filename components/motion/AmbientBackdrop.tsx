'use client';

import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { isSellsyRoute } from '@/lib/theme';
import WaveBackground from './WaveBackground';
import Globe from './Globe';

/** Routes that draw their own (interactive) globe and waves. */
const OWN_BACKDROP = ['/', '/login', '/signup'];

/**
 * App-wide "alive" canvas: fixed behind every portal and admin page, so the
 * blue/cyan waves keep undulating behind the glass cards while you scroll.
 * A decorative globe drifts in the corner (dark theme only). GPU-composited
 * fixed layer, capped at 30 fps so the blurred glass above it stays cheap;
 * pauses in background tabs and shows a still frame for reduced motion.
 * Three slow-drifting colour glows sit underneath, so the frosted cards above
 * have light to refract (static for reduced motion, hidden for reduced transparency).
 *
 * Sellsy routes (supplier portal, settings / profile) are always dark: the layer itself paints the
 * #050505 canvas (their page wrappers stay transparent so it shows through) and switches the glows,
 * waves and globe to the mint / teal palette. `.dark` here keeps the waves in additive dark mode and
 * the globe visible even when the rest of the site is light.
 */
export default function AmbientBackdrop() {
  const pathname = usePathname();
  if (OWN_BACKDROP.includes(pathname)) return null;
  const mint = isSellsyRoute(pathname);
  return (
    <div aria-hidden className={clsx('pointer-events-none fixed inset-0 -z-10 transform-gpu overflow-hidden', mint && 'dark bg-[#050505]')}>
      {mint ? (
        <>
          <div className="ambient-glow -left-[10vw] -top-[12vh] h-[55vh] w-[55vh] bg-[#5a9895]/15" />
          <div className="ambient-glow right-[-8vw] top-[30vh] h-[50vh] w-[50vh] bg-teal-500/10 [animation-delay:-9s]" />
          <div className="ambient-glow bottom-[-15vh] left-[30vw] h-[45vh] w-[45vh] bg-[#8fd3cc]/[0.07] [animation-delay:-18s]" />
        </>
      ) : (
        <>
          <div className="ambient-glow -left-[10vw] -top-[12vh] h-[55vh] w-[55vh] bg-blue-600/10 dark:bg-blue-600/15" />
          <div className="ambient-glow right-[-8vw] top-[30vh] h-[50vh] w-[50vh] bg-cyan-500/10 [animation-delay:-9s]" />
          <div className="ambient-glow bottom-[-15vh] left-[30vw] h-[45vh] w-[45vh] bg-violet-600/[0.08] [animation-delay:-18s]" />
        </>
      )}
      <WaveBackground band={0.62} intensity={mint ? 0.6 : 0.75} speed={0.8} maxFps={30} fade={false} palette={mint ? 'mint' : 'electric'} className="opacity-90" />
      <div className={clsx('absolute -bottom-[28vh] -right-[18vh] hidden aspect-square w-[78vh] dark:block', mint ? 'opacity-50' : 'opacity-40')}>
        <Globe className="h-full w-full" interactive={false} labels={false} maxFps={30} focus={{ lat: 8, lon: 24 }} palette={mint ? 'mint' : 'electric'} />
      </div>
    </div>
  );
}
