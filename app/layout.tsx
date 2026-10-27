import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
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
import { siteUrl, SITE_NAME } from '@/lib/seo';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

const DESCRIPTION = 'Import from verified suppliers in Europe, the Americas and Asia. One fixed landed price, freight and customs included, held in escrow until delivery.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: 'SokoGlobal · Escrow-protected B2B imports to Africa',
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: 'website', siteName: SITE_NAME, title: 'SokoGlobal · Escrow-protected B2B imports to Africa', description: DESCRIPTION, url: '/' },
  twitter: { card: 'summary', title: 'SokoGlobal · Escrow-protected B2B imports to Africa', description: DESCRIPTION },
  // Google Search Console ownership of https://sokoglobal.shop (also public/google68175376fc092f5f.html). Keep both.
  verification: { google: 'hX4cYkiOS-NKcQFPbyaGW_EMY7uNkvozJkDB775TDGM' },
  // Icons come from app/icon.svg, app/favicon.ico and app/apple-icon.png (Next.js file conventions).
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
        {/* Streams in on its own: the pause notice is rare, so no page waits for its settings read. */}
        <Suspense fallback={null}><PlatformBanner /></Suspense>
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
