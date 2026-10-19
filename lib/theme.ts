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
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}');var d=p==='dark'||((p===null||p==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
