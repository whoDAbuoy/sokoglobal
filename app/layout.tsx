import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { CurrencyCountrySync, CurrencyProvider } from '@/context/CurrencyContext';
import { getCurrencyState } from '@/lib/currency-server';
import { ChatProvider } from '@/context/ChatContext';
import CartDrawer from '@/components/cart/CartDrawer';
import AmbientBackdrop from '@/components/motion/AmbientBackdrop';
import PlatformBanner from '@/components/platform/PlatformBanner';
import ThemedToaster from '@/components/platform/ThemedToaster';
import ThemeSync from '@/components/platform/ThemeSync';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'SokoGlobal — Escrow-protected B2B imports to Africa',
  description: 'Source beauty and apparel from verified Western suppliers with guaranteed landed cost and escrow protection.',
};

// Android Chrome: the on-screen keyboard resizes the layout viewport, so sticky chat composers stay visible.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers opts every route into dynamic rendering, so each
  // response is rendered with that request's CSP nonce (prerendered HTML would
  // carry no nonce). Pass `nonce` to any third-party <Script nonce={nonce} />.
  const [nonce, money] = await Promise.all([headers().then((h) => h.get('x-nonce') ?? undefined), getCurrencyState()]);
  return (
    // suppressHydrationWarning: the theme script adds class="dark" and color-scheme before React hydrates.
    // <html> gets no className prop on purpose: React then never owns (or resets) its class attribute,
    // so only the theme script, ThemeSync and Settings change it. The font variable lives on <body>.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Lets the browser paint its canvas and controls in the right scheme before any CSS arrives. */}
        <meta name="color-scheme" content="light dark" />
        {/* Applies the saved light/dark theme before first paint (no flash). Nonce-allowed under the CSP.
            suppressHydrationWarning: browsers hide a nonce from the DOM once the page loads (the attribute reads
            back as ""), so React would flag a server/client mismatch. The nonce has already done its job by then. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} min-h-screen font-sans`}>
        <ThemeSync />
        <AmbientBackdrop />
        <PlatformBanner />
        <CurrencyProvider initialCurrency={money.currency} pinned={money.pinned} rates={money.rates} ratesUpdatedAt={money.ratesUpdatedAt}>
          <AuthProvider>
            <CurrencyCountrySync />
            <ChatProvider>
              <CartProvider>
                {children}
                <CartDrawer />
              </CartProvider>
            </ChatProvider>
          </AuthProvider>
        </CurrencyProvider>
        <ThemedToaster />
      </body>
    </html>
  );
}
