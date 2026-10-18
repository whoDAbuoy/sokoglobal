import type { Config } from 'tailwindcss';

// Saleor-inspired neutral scale: near-black primary, warm-neutral grays.
const neutral = {
  50: '#fafafa',
  100: '#f5f5f5',
  200: '#e5e5e5',
  300: '#d4d4d4',
  400: '#a3a3a3',
  500: '#737373',
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  950: '#0a0a0a',
};

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Monochrome brand (Saleor storefront look). Emerald stays reserved for
        // escrow / verified / success states; amber and red for warnings and errors.
        brand: neutral,
        // Remap slate to true neutral so every existing gray drops its blue tint.
        slate: neutral,
      },
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
      // Crisper radii: buttons/inputs ~6px, cards and panels 8px.
      borderRadius: {
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.5rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
        overlay: '0 16px 48px -12px rgb(0 0 0 / 0.25)',
      },
      letterSpacing: {
        eyebrow: '0.12em',
      },
    },
  },
  plugins: [],
};

export default config;
