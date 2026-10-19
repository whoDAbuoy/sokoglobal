'use client';

import { usePathname } from 'next/navigation';
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
 */
export default function AmbientBackdrop() {
  const pathname = usePathname();
  if (OWN_BACKDROP.includes(pathname)) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 transform-gpu overflow-hidden">
      <WaveBackground band={0.62} intensity={0.75} speed={0.8} maxFps={30} fade={false} className="opacity-90" />
      <div className="absolute -bottom-[28vh] -right-[18vh] hidden aspect-square w-[78vh] opacity-40 dark:block">
        <Globe className="h-full w-full" interactive={false} labels={false} maxFps={30} focus={{ lat: 8, lon: 24 }} />
      </div>
    </div>
  );
}
