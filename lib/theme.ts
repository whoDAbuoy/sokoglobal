/** Light / dark theme preference (per device, localStorage). Applied as the `dark` class on <html>. */
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_KEY = 'sokoglobal.theme';

export function parseTheme(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/** The theme actually shown for a preference, given the OS setting. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): 'light' | 'dark' {
  return pref === 'system' ? (systemPrefersDark ? 'dark' : 'light') : pref;
}

/**
 * Inline script for <head>: sets the class before first paint so there is no
 * light flash for dark-mode users. Keep it tiny and dependency-free.
 *  - Storage is read in its own try: if it is blocked (privacy mode, embedded
 *    browsers) the OS preference still applies instead of the whole script failing.
 *  - It also sets the root `color-scheme`, so the browser canvas, scrollbars and
 *    form controls are dark from the very first frame, before the stylesheet applies.
 */
export const THEME_INIT_SCRIPT = `(function(){var p=null;try{p=localStorage.getItem('${THEME_KEY}')}catch(e){}`
  + `try{var d=p==='dark'||(p!=='light'&&!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));`
  + `var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

/** Route roots drawn in the always-dark Sellsy style (each also covers everything below it). */
const SELLSY_ROOTS = ['/supplier', '/dashboard', '/rfqs', '/admin', '/products', '/suppliers', '/legal', '/help'];

/**
 * Routes drawn in the always-dark Sellsy style (pure-black canvas, charcoal glass cards, mint accents):
 * the supplier portal, the whole buyer side (dashboard, catalogue, checkout, orders, settings, RFQs), admin and the
 * public listing and supplier pages (migration 036).
 * The ambient backdrop switches to its mint palette there, whatever the site theme.
 */
export function isSellsyRoute(pathname: string | null | undefined): boolean {
  const p = pathname ?? '';
  return SELLSY_ROOTS.some((root) => p === root || p.startsWith(`${root}/`));
}
