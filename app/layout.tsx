import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { ChatProvider } from '@/context/ChatContext';
import CartDrawer from '@/components/cart/CartDrawer';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'SokoGlobal — Escrow-protected B2B imports to Africa',
  description: 'Source beauty and apparel from verified Western suppliers with guaranteed landed cost and escrow protection.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers opts every route into dynamic rendering, so each
  // response is rendered with that request's CSP nonce (prerendered HTML would
  // carry no nonce). Pass `nonce` to any third-party <Script nonce={nonce} />.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // suppressHydrationWarning: the theme script may add class="dark" before React hydrates.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Applies the saved light/dark theme before first paint (no flash). Nonce-allowed under the CSP. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <AuthProvider>
          <ChatProvider>
            <CartProvider>
              {children}
              <CartDrawer />
            </CartProvider>
          </ChatProvider>
        </AuthProvider>
        <Toaster closeButton position="top-right"
          toastOptions={{ classNames: { toast: 'rounded-lg border border-neutral-200 shadow-overlay font-sans', description: 'text-neutral-500' } }} />
      </body>
    </html>
  );
}
