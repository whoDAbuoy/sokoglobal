import { Suspense } from 'react';
import Auth from '@/components/Auth';

export const metadata = { title: 'Create account · SokoGlobal' };

export default function SignupPage() {
  return (
    <Suspense>
      <Auth mode="signup" />
    </Suspense>
  );
}
