import { Suspense } from 'react';
import Auth from '@/components/Auth';

export const metadata = { title: 'Sign in · SokoGlobal' };

export default function LoginPage() {
  return (
    <Suspense>
      <Auth mode="login" />
    </Suspense>
  );
}
