'use client';

import { useEffect, useState, type FormEvent } from 'react';
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
import { homePathFor } from '@/lib/auth/admin-access';
import { BIO_MAX, BIO_MIN, normalizeBio } from '@/lib/settings';

type Mode = 'login' | 'signup';
type SignupRole = Exclude<UserRole, 'admin' | 'super_admin'>;

/** Email typed on one auth page survives a hop to the other (tab-scoped; never the password). */
const EMAIL_DRAFT_KEY = 'sokoglobal.auth.email';
const MINT_TEXT = 'bg-gradient-to-r from-[#8fd3cc] via-teal-300 to-cyan-300 bg-clip-text text-transparent';

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
  if (/banned/i.test(message)) return 'This account has been suspended. Contact SokoGlobal trade support if you think this is a mistake.';
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
  const [bio, setBio] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'confirmation_failed' ? 'That confirmation link is invalid or expired.'
      : searchParams.get('error') === 'reset_failed' ? 'That password reset link is invalid or expired. Enter your email and choose “Forgot password?” to get a new one.'
      : searchParams.get('error') === 'banned' ? 'This account has been suspended. Contact SokoGlobal trade support if you think this is a mistake.' : null,
  );
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  const strength = passwordStrength(password);
  const countries = role === 'supplier' ? SUPPLIER_COUNTRIES : IMPORTER_COUNTRIES;
  const redirectTo = (() => {
    const r = searchParams.get('redirectTo');
    return r && r.startsWith('/') && !r.startsWith('//') ? r : null;
  })();

  // Restore / remember the email draft (read after mount so server and client render the same markup).
  useEffect(() => {
    try { const saved = sessionStorage.getItem(EMAIL_DRAFT_KEY); if (saved) setEmail((e) => e || saved); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    try { if (email) sessionStorage.setItem(EMAIL_DRAFT_KEY, email); } catch { /* storage blocked */ }
  }, [email]);
  /** Sign in ⇄ Sign up links keep where the user was heading (and the supplier choice on sign-up). */
  const otherAuthHref = (() => {
    const q = new URLSearchParams();
    if (redirectTo) q.set('redirectTo', redirectTo);
    if (mode === 'signup' && role === 'supplier') q.set('role', 'supplier');
    const qs = q.toString();
    return `${mode === 'login' ? '/signup' : '/login'}${qs ? `?${qs}` : ''}`;
  })();

  async function routeByRole(userId: string) {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single<{ role: UserRole }>();
    router.replace(redirectTo ?? homePathFor(data?.role));
    router.refresh();
  }

  async function handleResetPassword() {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter your email above, then click “Forgot password?”.');
    // Supabase emails a recovery link; /auth/callback signs the user in with a recovery session and
    // sends them to /auth/reset-password to choose a new password.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/auth/reset-password')}`,
    });
    if (error) setError(mapAuthError(error.message));
    else setConfirmationSentTo(email.trim());
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const bioCheck = normalizeBio(bio);

    if (mode === 'signup') {
      if (strength.score < 2) return setError('Use at least 10 characters with upper & lower case letters.');
      if (!country) return setError('Please select your country.');
      if (!bioCheck.ok) return setError(bioCheck.error);
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
          data: { role, full_name: fullName.trim(), company_name: company.trim(), country_code: country, bio: bioCheck.ok ? bioCheck.value : '' },
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
    // Superlist-style split: an info panel and the form card, both iOS-style frosted glass, floating over a
    // full-viewport interactive globe and the live waves. The content layer comes first in the DOM so
    // keyboard focus reaches the form before the globe; gaps between panels let pointer drags reach the globe.
    <div className="dark sellsy relative isolate min-h-screen overflow-hidden bg-[#050505] text-neutral-900">
      <div className="pointer-events-none relative z-10 mx-auto grid min-h-screen max-w-6xl content-center gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-12">
        {/* Left: brand, value proposition and trust points */}
        <aside className="sx-glass pointer-events-auto hidden flex-col p-8 motion-safe:animate-fade-up lg:flex xl:p-10">
          <Link href="/" className="flex w-fit items-center gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]">
            <ShieldCheck className="h-5 w-5 text-[#8fd3cc]" strokeWidth={2.25} aria-hidden />
            <span className="text-lg font-semibold tracking-tight">SokoGlobal</span>
          </Link>

          <h1 className="mt-6 text-3xl font-semibold leading-[1.1] xl:text-4xl">
            Source from the West.{' '}
            <span className={MINT_TEXT}>Pay only when it lands.</span>
          </h1>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-neutral-600">
            <CheckCircle2 className="h-4 w-4 text-[#8fd3cc]" aria-hidden /> Escrow on every order · no surprise fees
          </p>

          <ul className="mt-10 space-y-8">
            {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <Icon className="h-6 w-6 text-[#8fd3cc]" strokeWidth={1.75} aria-hidden />
                <p className="mt-3 text-sm font-semibold">{title}</p>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-neutral-600">{body}</p>
              </li>
            ))}
          </ul>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-10 text-xs text-neutral-600">
            <p>Bank-grade encryption · Licensed escrow partner · 24/7 support</p>
            <p className="flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5" aria-hidden /> Drag the globe to explore</p>
          </div>
        </aside>

      {/* Right: the form card */}
      <main className="pointer-events-auto flex items-center">
        <div className="mx-auto w-full max-w-lg lg:max-w-none">
          <Link href="/" className="mb-6 flex w-fit items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895] lg:hidden">
            <ShieldCheck className="h-5 w-5 text-[#8fd3cc]" strokeWidth={2.25} aria-hidden />
            <span className="text-base font-semibold tracking-tight">SokoGlobal</span>
          </Link>
          <div className="sx-glass p-6 motion-safe:animate-scale-in sm:p-9">
          {confirmationSentTo ? (
            <div className="py-4 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </span>
              <h2 className="mt-4 text-xl font-semibold">Check your email</h2>
              <p className="mt-2 text-sm text-neutral-600">
                We sent a secure link to <span className="font-medium text-neutral-900">{confirmationSentTo}</span>.
                Open it to continue securely.
              </p>
              <Link href="/login" className="btn-secondary mt-6 w-full">Back to sign in</Link>
            </div>
          ) : (
            <>
              <h2 className="text-3xl font-semibold text-neutral-900">
                {mode === 'login' ? 'Welcome back' : 'Create your trade account'}
              </h2>
              <p className="mt-1.5 text-sm text-neutral-600">
                {mode === 'login' ? (
                  <>New to SokoGlobal? <Link href={otherAuthHref} className="font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Create an account</Link></>
                ) : (
                  <>Already registered? <Link href={otherAuthHref} className="font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Sign in</Link></>
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
                              'relative rounded-2xl border p-4 text-left transition-all duration-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]',
                              active ? 'border-[#5a9895] bg-[#5a9895]/15 ring-1 ring-[#5a9895]' : 'border-snow/10 bg-snow/[0.03] hover:border-snow/25',
                            )}
                          >
                            {active && <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-[#8fd3cc]" />}
                            <Icon className={clsx('h-5 w-5', active ? 'text-[#8fd3cc]' : 'text-neutral-400')} strokeWidth={1.75} />
                            <p className="mt-3 text-sm font-semibold text-neutral-900">{title}</p>
                            <p className="mt-0.5 text-xs leading-snug text-neutral-500">{subtitle}</p>
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
                    <div className="sm:col-span-2">
                      <label htmlFor="bio" className="label">Short bio</label>
                      <textarea id="bio" required minLength={BIO_MIN} maxLength={BIO_MAX} rows={3} className="input resize-y" value={bio}
                        onChange={(e) => setBio(e.target.value)} aria-describedby="bio-hint"
                        placeholder={role === 'supplier' ? 'What you make, where you ship from, your minimums…' : 'Your business, what you stock and where you sell…'} />
                      <p id="bio-hint" className="mt-1 flex justify-between gap-2 text-xs text-neutral-500">
                        <span>Shown on your public profile.</span>
                        <span className={clsx('tabular-nums', bio.trim().length > 0 && bio.trim().length < BIO_MIN && 'text-amber-300')}>{bio.trim().length}/{BIO_MAX}</span>
                      </p>
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
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <input id="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'signup' ? 10 : 1}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      className="input pl-10 pr-10" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
                    <button type="button" onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {mode === 'signup' && password && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex flex-1 gap-1">
                        {[1, 2, 3].map((i) => (
                          <span key={i} className={clsx('h-1 flex-1 rounded-full',
                            strength.score >= i ? ['bg-red-500', 'bg-amber-500', 'bg-emerald-500'][strength.score - 1] : 'bg-neutral-200')} />
                        ))}
                      </div>
                      <span className="text-xs text-neutral-600">{strength.label}</span>
                    </div>
                  )}
                </div>

                {mode === 'signup' && (
                  <label className="flex items-start gap-2.5 text-sm text-neutral-600">
                    <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-[#5a9895] focus:ring-[#5a9895]" />
                    <span>I agree to the <a href="#" className="font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Terms of Trade</a> and{' '}
                      <a href="#" className="font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600">Escrow Agreement</a>.</span>
                  </label>
                )}

                {error && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
                  </div>
                )}

                <button type="submit" disabled={submitting} className="btn-primary w-full py-3 active:scale-95">
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

      {/* Background: live waves behind a full-viewport interactive globe (drag in the gaps, or Tab to it and use the arrow keys). */}
      <div className="absolute inset-0 z-0">
        <div aria-hidden className="ambient-glow left-1/2 top-1/2 h-[60vh] w-[60vh] -translate-x-1/2 -translate-y-1/2 bg-[#5a9895]/20" />
        <WaveBackground band={0.8} intensity={0.85} palette="mint" />
        <div className="absolute left-1/2 top-1/2 aspect-square w-[min(115vw,104vh)] -translate-x-1/2 -translate-y-1/2 lg:left-1/2">
          <Globe className="h-full w-full" focus={{ lat: 14, lon: 30 }} palette="mint" />
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, icon: Icon, children }: { id: string; label: string; icon: typeof Mail; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        {children}
      </div>
    </div>
  );
}
