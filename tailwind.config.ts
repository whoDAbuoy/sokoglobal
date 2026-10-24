import type { Config } from 'tailwindcss';

// Saleor-inspired neutral scale: near-black primary, warm-neutral grays.
// Values live in CSS variables (app/globals.css) so the whole scale — and
// white — flips for dark mode (`.dark` on <html>) without per-component dark: classes.
const shade = (n: string) => `rgb(var(--sg-neutral-${n}) / <alpha-value>)`;
const neutral = Object.fromEntries(
  ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].map((n) => [n, shade(n)]),
);

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Monochrome brand (Saleor storefront look). Emerald stays reserved for
        // escrow / verified / success states; amber and red for warnings and errors.
        neutral,
        brand: neutral,
        // Remap slate to true neutral so every existing gray drops its blue tint.
        slate: neutral,
        white: 'rgb(var(--sg-white) / <alpha-value>)',
        // Fixed colours that never flip with the theme (text on blue buttons, the midnight canvas).
        snow: '#ffffff',
        midnight: '#030712',
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
      // Quick View modal entry/exit.
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'scale-in': { from: { opacity: '0', transform: 'translateY(8px) scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
        'scale-out': { from: { opacity: '1', transform: 'none' }, to: { opacity: '0', transform: 'translateY(8px) scale(0.97)' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(16px)' }, to: { opacity: '1', transform: 'none' } },
        'heart-pop': { '0%': { transform: 'scale(1)' }, '40%': { transform: 'scale(1.35)' }, '70%': { transform: 'scale(0.9)' }, '100%': { transform: 'scale(1)' } },
        // Motion overhaul
        'pulse-ring': { '0%': { transform: 'scale(1)', opacity: '0.55' }, '80%, 100%': { transform: 'scale(2.1)', opacity: '0' } },
        'word-in': { from: { opacity: '0', filter: 'blur(10px)', transform: 'translateY(35%)' }, to: { opacity: '1', filter: 'blur(0)', transform: 'none' } },
        'word-out': { from: { opacity: '1', filter: 'blur(0)', transform: 'none' }, to: { opacity: '0', filter: 'blur(10px)', transform: 'translateY(-35%)' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'none' } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        // Ambient glows: a slow wander, transform only (composited, no repaint).
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '33%': { transform: 'translate3d(6%, -4%, 0) scale(1.08)' },
          '66%': { transform: 'translate3d(-5%, 5%, 0) scale(0.95)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
        'fade-out': 'fade-out 160ms ease-in both',
        'scale-in': 'scale-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-out': 'scale-out 160ms ease-in both',
        'slide-in-right': 'slide-in-right 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-up': 'slide-up 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'heart-pop': 'heart-pop 420ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        'word-in': 'word-in 520ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'word-out': 'word-out 360ms ease-in both',
        'fade-up': 'fade-up 600ms cubic-bezier(0.16, 1, 0.3, 1) both',
        float: 'float 6s ease-in-out infinite',
        drift: 'drift 28s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
