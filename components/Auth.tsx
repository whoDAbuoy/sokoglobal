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
import { IMPORTER_COUNTRIES, SUPPLIER_COUNTRIES, dialCode } from '@/lib/countries';
import Globe from '@/components/motion/Globe';
import WaveBackground from '@/components/motion/WaveBackground';

type Mode = 'login' | 'signup';
type SignupRole = Exclude<UserRole, 'admin'>;


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

  // ?role=supplier preselects the supplier card (landing page "Sell as a supplier").
  const [role, setRole] = useState<SignupRole>(searchParams.get('role') === 'supplier' ? 'supplier' : 'importer');
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
    // Always midnight: large globe + live waves on the left, a frosted form card on the right.
    <div className="dark relative isolate min-h-screen overflow-hidden bg-midnight text-neutral-900">
      <WaveBackground band={0.78} intensity={0.85} className="-z-10" />
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Left: large left-aligned globe that bleeds off the edge, with the value proposition on a frosted panel */}
      <aside className="relative hidden min-h-screen overflow-hidden lg:block">
        <div className="absolute left-[-14%] top-[46%] aspect-square w-[min(112%,88vh)] -translate-y-1/2">
          <Globe className="h-full w-full" focus={{ lat: 16, lon: 26 }} />
        </div>

        <div className="pointer-events-none relative z-10 flex min-h-screen flex-col justify-between gap-8 px-10 py-10 xl:px-14">
          <Link href="/" className="pointer-events-auto frost-bar flex w-fit items-center gap-2.5 rounded-full border px-3.5 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
            <ShieldCheck className="h-5 w-5 text-cyan-400" strokeWidth={2.25} aria-hidden />
            <span className="text-lg font-semibold tracking-tight">SokoGlobal</span>
          </Link>

          <div className="pointer-events-auto frost-card max-w-xl rounded-2xl p-6 xl:p-7">
            <p className="text-xs font-medium uppercase tracking-eyebrow text-cyan-400">B2B imports, de-risked</p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.06] xl:text-5xl">
              Source from the West.<br />
              <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-indigo-400 bg-clip-text text-transparent">Pay only when it lands.</span>
            </h1>
            <ul className="mt-6 grid gap-3 xl:grid-cols-3">
              {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3 xl:flex-col xl:gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cyan-500/25 bg-cyan-500/10">
                    <Icon className="h-4 w-4 text-cyan-400" strokeWidth={1.75} aria-hidden />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-snow/10 pt-4 text-xs text-neutral-600">
              Bank-grade encryption · Funds held by a licensed escrow partner · 24/7 trade support
            </p>
          </div>
        </div>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-6 flex w-fit items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 lg:hidden">
            <ShieldCheck className="h-5 w-5 text-cyan-400" strokeWidth={2.25} aria-hidden />
            <span className="text-base font-semibold tracking-tight">SokoGlobal</span>
          </Link>
          <div className="frost-card rounded-2xl p-6 motion-safe:animate-scale-in sm:p-8">
          {confirmationSentTo ? (
            <div className="py-4 text-center">
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
              <h2 className="text-3xl font-semibold text-neutral-900">
                {mode === 'login' ? 'Welcome back' : 'Create your trade account'}
              </h2>
              <p className="mt-1.5 text-sm text-slate-600">
                {mode === 'login' ? (
                  <>New to SokoGlobal? <Link href="/signup" className="font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Create an account</Link></>
                ) : (
                  <>Already registered? <Link href="/login" className="font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Sign in</Link></>
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
                              'relative rounded-lg border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2',
                              active ? 'border-neutral-900 bg-white ring-1 ring-neutral-900' : 'border-neutral-200 bg-white hover:border-neutral-400',
                            )}
                          >
                            {active && <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-neutral-900" />}
                            <Icon className={clsx('h-5 w-5', active ? 'text-neutral-900' : 'text-neutral-400')} strokeWidth={1.75} />
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
                          {countries.map((c) => <option key={c} value={c}>{regionNames.of(c)} ({dialCode(c)})</option>)}
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
                        className="mb-1.5 text-xs font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Forgot password?</button>
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
                      <span className="text-xs text-neutral-600">{strength.label}</span>
                    </div>
                  )}
                </div>

                {mode === 'signup' && (
                  <label className="flex items-start gap-2.5 text-sm text-slate-600">
                    <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900" />
                    <span>I agree to the <a href="#" className="font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Terms of Trade</a> and{' '}
                      <a href="#" className="font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Escrow Agreement</a>.</span>
                  </label>
                )}

                {error && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
                  </div>
                )}

                <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {mode === 'login' ? 'Sign in securely' : `Create ${role === 'supplier' ? 'supplier' : 'importer'} account`}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>

              <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-neutral-600">
                <Lock className="h-3.5 w-3.5" /> Protected by 256-bit TLS encryption
              </p>
            </>
          )}
          </div>
        </div>
      </main>
      </div>
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
