'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import {
  AlertCircle, ArrowRight, BadgeCheck, Building2, CheckCircle2, Eye, EyeOff, Globe2,
  Loader2, Lock, Mail, PackageCheck, Plane, ShieldCheck, Store, User,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/lib/types';

type Mode = 'login' | 'signup';
type SignupRole = Exclude<UserRole, 'admin'>;

const SUPPLIER_COUNTRIES = ['US', 'GB', 'CA', 'FR', 'DE', 'IT', 'ES', 'NL', 'BE', 'SE', 'KR', 'JP', 'AE', 'TR'];
const IMPORTER_COUNTRIES = ['NG', 'KE', 'GH', 'ZA', 'CI', 'SN', 'TZ', 'UG', 'RW', 'ET', 'CM', 'EG', 'MA', 'ZM', 'BW'];

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

const ROLE_OPTIONS: { value: SignupRole; title: string; subtitle: string; icon: typeof Store }[] = [
  { value: 'importer', title: 'African Importer', subtitle: 'Boutiques, retailers & distributors buying stock', icon: Store },
  { value: 'supplier', title: 'Western Supplier', subtitle: 'Brands & wholesalers selling into Africa', icon: Plane },
];

const TRUST_POINTS = [
  { icon: ShieldCheck, title: 'Escrow-protected payments', body: 'Funds are released to suppliers only after goods are verified at your door.' },
  { icon: PackageCheck, title: 'Guaranteed Landed Cost', body: 'Product, consolidated air freight and customs clearance in one fixed price.' },
  { icon: BadgeCheck, title: 'Verified suppliers & real photos', body: 'KYC-checked sellers with live product photos and standardized swatch videos.' },
];

function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return { score: score as 0 | 1 | 2 | 3, label: ['Too short', 'Weak', 'Good', 'Strong'][score] };
}

function mapAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email address first — check your inbox.';
  if (/already registered/i.test(message)) return 'An account with this email already exists. Try signing in.';
  if (/rate limit/i.test(message)) return 'Too many attempts. Please wait a minute and try again.';
  return message;
}

export default function Auth({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [role, setRole] = useState<SignupRole>('importer');
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'confirmation_failed' ? 'That confirmation link is invalid or expired.' : null,
  );
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  const strength = passwordStrength(password);
  const countries = role === 'supplier' ? SUPPLIER_COUNTRIES : IMPORTER_COUNTRIES;
  const redirectTo = (() => {
    const r = searchParams.get('redirectTo');
    return r && r.startsWith('/') && !r.startsWith('//') ? r : null;
  })();

  async function routeByRole(userId: string) {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single<{ role: UserRole }>();
    router.replace(redirectTo ?? (data?.role === 'admin' ? '/admin' : data?.role === 'supplier' ? '/supplier' : '/dashboard'));
    router.refresh();
  }

  async function handleResetPassword() {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter your email above, then click “Forgot password?”.');
    // Supabase emails a recovery link; after the callback the user is signed in and can
    // set a new password via supabase.auth.updateUser({ password }).
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    if (error) setError(mapAuthError(error.message));
    else setConfirmationSentTo(email.trim());
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'signup') {
      if (strength.score < 2) return setError('Use at least 10 characters with upper & lower case letters.');
      if (!country) return setError('Please select your country.');
      if (!acceptTerms) return setError('Please accept the Terms and Escrow Agreement to continue.');
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        await routeByRole(data.user.id);
        return;
      }

      // Metadata is read by the `handle_new_user` trigger in schema.sql to create the profile row.
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: { role, full_name: fullName.trim(), company_name: company.trim(), country_code: country },
        },
      });
      if (error) throw error;

      if (data.session && data.user) await routeByRole(data.user.id);
      else setConfirmationSentTo(email.trim()); // Email confirmation is enabled in Supabase Auth.
    } catch (err) {
      setError(mapAuthError(err instanceof Error ? err.message : 'Unexpected error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      {/* Brand / trust panel */}
      <aside className="relative hidden overflow-hidden bg-brand-950 px-12 py-14 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

        <Link href="/" className="relative flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 ring-1 ring-white/20">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
          </span>
          <span className="text-lg font-semibold tracking-tight">SokoGlobal</span>
        </Link>

        <div className="relative mt-auto max-w-md">
          <p className="text-sm font-medium uppercase tracking-wider text-brand-300">B2B imports, de-risked</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">
            Source from the West.<br />Pay only when it lands.
          </h1>
          <ul className="mt-10 space-y-6">
            {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10">
                  <Icon className="h-5 w-5 text-emerald-300" />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-300">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative mt-auto pt-12 text-xs text-slate-400">
          Bank-grade encryption · Funds held by a licensed escrow partner · 24/7 trade support
        </p>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          {confirmationSentTo ? (
            <div className="card p-8 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </span>
              <h2 className="mt-4 text-xl font-semibold">Check your email</h2>
              <p className="mt-2 text-sm text-slate-600">
                We sent a secure link to <span className="font-medium text-slate-900">{confirmationSentTo}</span>.
                Open it to continue securely.
              </p>
              <Link href="/login" className="btn-secondary mt-6 w-full">Back to sign in</Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">
                {mode === 'login' ? 'Welcome back' : 'Create your trade account'}
              </h2>
              <p className="mt-1.5 text-sm text-slate-600">
                {mode === 'login' ? (
                  <>New to SokoGlobal? <Link href="/signup" className="font-medium text-brand-700 hover:underline">Create an account</Link></>
                ) : (
                  <>Already registered? <Link href="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>
                )}
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
                {mode === 'signup' && (
                  <fieldset>
                    <legend className="label">I am a…</legend>
                    <div className="grid grid-cols-2 gap-3" role="radiogroup">
                      {ROLE_OPTIONS.map(({ value, title, subtitle, icon: Icon }) => {
                        const active = role === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => { setRole(value); setCountry(''); }}
                            className={clsx(
                              'relative rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20',
                              active ? 'border-brand-700 bg-brand-50 ring-1 ring-brand-700' : 'border-slate-200 bg-white hover:border-slate-300',
                            )}
                          >
                            {active && <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-brand-700" />}
                            <Icon className={clsx('h-5 w-5', active ? 'text-brand-700' : 'text-slate-500')} />
                            <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
                            <p className="mt-0.5 text-xs leading-snug text-slate-500">{subtitle}</p>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {mode === 'signup' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="fullName" label="Full name" icon={User}>
                      <input id="fullName" required autoComplete="name" className="input pl-10" value={fullName}
                        onChange={(e) => setFullName(e.target.value)} placeholder="Amara Okafor" />
                    </Field>
                    <Field id="company" label={role === 'supplier' ? 'Company / brand' : 'Business name'} icon={Building2}>
                      <input id="company" required autoComplete="organization" className="input pl-10" value={company}
                        onChange={(e) => setCompany(e.target.value)} placeholder={role === 'supplier' ? 'Maison Rouge Ltd' : 'Glow Boutique'} />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field id="country" label={role === 'supplier' ? 'Country of operation' : 'Import destination'} icon={Globe2}>
                        <select id="country" required className="input appearance-none pl-10" value={country}
                          onChange={(e) => setCountry(e.target.value)}>
                          <option value="">Select a country</option>
                          {countries.map((c) => <option key={c} value={c}>{regionNames.of(c)}</option>)}
                        </select>
                      </Field>
                    </div>
                  </div>
                )}

                <Field id="email" label="Work email" icon={Mail}>
                  <input id="email" type="email" required autoComplete="email" className="input pl-10" value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                </Field>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="label">Password</label>
                    {mode === 'login' && (
                      <button type="button" onClick={handleResetPassword}
                        className="mb-1.5 text-xs font-medium text-brand-700 hover:underline">Forgot password?</button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input id="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'signup' ? 10 : 1}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      className="input pl-10 pr-10" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
                    <button type="button" onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {mode === 'signup' && password && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex flex-1 gap-1">
                        {[1, 2, 3].map((i) => (
                          <span key={i} className={clsx('h-1 flex-1 rounded-full',
                            strength.score >= i ? ['bg-red-500', 'bg-amber-500', 'bg-emerald-500'][strength.score - 1] : 'bg-slate-200')} />
                        ))}
                      </div>
                      <span className="text-xs text-slate-500">{strength.label}</span>
                    </div>
                  )}
                </div>

                {mode === 'signup' && (
                  <label className="flex items-start gap-2.5 text-sm text-slate-600">
                    <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600" />
                    <span>I agree to the <a href="#" className="font-medium text-brand-700 hover:underline">Terms of Trade</a> and{' '}
                      <a href="#" className="font-medium text-brand-700 hover:underline">Escrow Agreement</a>.</span>
                  </label>
                )}

                {error && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
                  </div>
                )}

                <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {mode === 'login' ? 'Sign in securely' : `Create ${role === 'supplier' ? 'supplier' : 'importer'} account`}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>

              <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <Lock className="h-3.5 w-3.5" /> Protected by 256-bit TLS encryption
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ id, label, icon: Icon, children }: { id: string; label: string; icon: typeof Mail; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
        {children}
      </div>
    </div>
  );
}
