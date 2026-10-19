'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { toast } from 'sonner';
import {
  AlertCircle, BadgeCheck, Building2, CheckCircle2, Eye, EyeOff, Globe2, KeyRound, Loader2, Monitor, Moon, Palette, Sun, Wallet,
} from 'lucide-react';
import type { Profile } from '@/lib/types';
import { countryName, flag } from '@/lib/format';
import { dialCode } from '@/lib/countries';
import { passwordStrength, validatePasswordChange, type PasswordChangeErrors } from '@/lib/password';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/hooks/useTheme';
import type { ThemePreference } from '@/lib/theme';

export type ProfileTab = 'account' | 'appearance' | 'security';

const ROLE_BADGE: Record<Profile['role'], { label: string; className: string }> = {
  importer: { label: 'Importer', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  supplier: { label: 'Supplier', className: 'border-neutral-300 bg-neutral-100 text-neutral-800' },
  admin: { label: 'Admin', className: 'border-amber-200 bg-amber-50 text-amber-800' },
};

const TAB_META: Record<ProfileTab, { label: string; icon: typeof Building2 }> = {
  account: { label: 'Account', icon: Building2 },
  appearance: { label: 'Appearance', icon: Palette },
  security: { label: 'Security', icon: KeyRound },
};

export default function ProfileSettings({ initialTab, profile, email, memberSince, regional }: {
  initialTab: ProfileTab;
  profile: Profile;
  email: string;
  memberSince: string | null;
  regional: { escrowCurrency: string; cardCurrency: string; mpesaEnabled: boolean };
}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const badge = ROLE_BADGE[profile.role];

  function select(next: ProfileTab) {
    setTab(next);
    window.history.replaceState(null, '', `?tab=${next}`);
  }

  return (
    <div className="card mt-8 overflow-hidden">
      {/* Profile header */}
      <div className="flex flex-wrap items-center gap-5 border-b border-neutral-200 p-6 sm:p-8">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-neutral-900 text-xl font-semibold text-white">{initials}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold text-neutral-900">{profile.full_name}</h2>
            <span className={clsx('pill', badge.className)}>{badge.label}</span>
            {profile.kyc_verified && <span className="pill border-emerald-200 bg-emerald-50 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /> Verified business</span>}
          </div>
          <p className="mt-1 truncate text-sm text-neutral-600">{profile.company_name}</p>
          <p className="truncate text-sm text-neutral-500">{email}</p>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Settings" className="flex gap-1 overflow-x-auto border-b border-neutral-200 px-4 sm:px-6">
        {(Object.keys(TAB_META) as ProfileTab[]).map((t) => {
          const { label, icon: Icon } = TAB_META[t];
          return (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => select(t)}
              className={clsx('-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3.5 text-sm font-medium transition-colors',
                tab === t ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800')}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="p-6 sm:p-8">
        {tab === 'account' && <AccountPanel profile={profile} memberSince={memberSince} regional={regional} />}
        {tab === 'appearance' && <AppearancePanel />}
        {tab === 'security' && <SecurityPanel email={email} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Account */

function AccountPanel({ profile, memberSince, regional }: {
  profile: Profile; memberSince: string | null; regional: { escrowCurrency: string; cardCurrency: string; mpesaEnabled: boolean };
}) {
  const code = profile.country_code.toUpperCase();
  const dial = dialCode(code);
  const isBuyer = profile.role === 'importer';
  const mpesaForYou = regional.mpesaEnabled && code === 'KE';

  return (
    <div className="space-y-8">
      <Section title="Business" icon={Building2}>
        <Row label="Business name" value={profile.company_name} />
        <Row label="Contact name" value={profile.full_name} />
        <Row label="Account type" value={ROLE_BADGE[profile.role].label} />
        <Row label="Member since" value={memberSince ? new Date(memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—'} />
      </Section>

      <Section title="Region" icon={Globe2}>
        <Row label="Country" value={<span>{flag(code)} {countryName(code)}</span>} />
        <Row label="Dialing code" value={dial ? <span className="tabular-nums">{dial}</span> : '—'} />
        {code === 'CN' && (
          <p className="sm:col-span-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            China ({dial}) is supported. {isBuyer
              ? 'M-Pesa needs a Kenyan Safaricom number, so pay by Bank Card (Visa / Mastercard).'
              : 'Supplier payouts in China are made by bank transfer — add your payout account under Verification.'}
          </p>
        )}
      </Section>

      <Section title="Payments" icon={Wallet}>
        <Row label="Escrow currency" value={`${regional.escrowCurrency} — every order is priced and held in escrow in US dollars`} />
        {isBuyer && (
          <>
            <Row label="M-Pesa" value={mpesaForYou ? 'Available · charged in KES at the platform rate (up to KES 250,000 per payment)'
              : regional.mpesaEnabled ? 'Kenyan Safaricom numbers only' : 'Not enabled'} />
            <Row label="Bank Card" value={`Visa / Mastercard · charged in ${regional.cardCurrency}`} />
          </>
        )}
        {profile.role === 'supplier' && (
          <Row label="Payouts" value={<span>Released from escrow after buyer verification · <Link href="/supplier/verification" className="underline underline-offset-4">payout account &amp; KYC</Link></span>} />
        )}
      </Section>
      <p className="text-xs text-neutral-500">To change your business name, country or role, contact SokoGlobal support — they’re tied to your verification.</p>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Building2; children: ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900"><Icon className="h-4 w-4 text-neutral-500" /> {title}</h3>
      <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-900">{value}</dd>
    </div>
  );
}

/* --------------------------------------------------------------- Appearance */

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun; hint: string }[] = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'Bright surfaces, dark text' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Easy on the eyes at night' },
  { value: 'system', label: 'System', icon: Monitor, hint: 'Follows your device setting' },
];

function AppearancePanel() {
  const { preference, setTheme } = useTheme();
  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-900">Theme</h3>
      <p className="mt-1 text-sm text-neutral-500">Saved on this device.</p>
      <div role="radiogroup" aria-label="Theme" className="mt-5 grid gap-4 sm:grid-cols-3">
        {THEMES.map(({ value, label, icon: Icon, hint }) => {
          const active = preference === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={active} onClick={() => setTheme(value)}
              className={clsx('rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2',
                active ? 'border-neutral-900 ring-1 ring-neutral-900' : 'border-neutral-200 hover:border-neutral-400')}>
              {/* Mini preview (fixed colours so it shows the target theme in either mode). */}
              <span aria-hidden className={clsx('flex h-20 overflow-hidden rounded-md border',
                value === 'dark' ? 'border-[#303030] bg-[#0c0c0c]' : value === 'light' ? 'border-[#e5e5e5] bg-[#ffffff]' : 'border-[#d4d4d4] bg-gradient-to-r from-[#ffffff] from-50% to-[#0c0c0c] to-50%')}>
                <span className="m-2 flex flex-1 flex-col gap-1.5">
                  <span className={clsx('h-2 w-1/2 rounded', value === 'dark' ? 'bg-[#f3f3f3]' : 'bg-[#171717]')} />
                  <span className={clsx('h-2 w-3/4 rounded', value === 'dark' ? 'bg-[#4a4a4a]' : 'bg-[#d4d4d4]')} />
                  <span className={clsx('mt-auto h-4 w-1/3 rounded', value === 'dark' ? 'bg-[#f3f3f3]' : 'bg-[#171717]')} />
                </span>
              </span>
              <span className="mt-3 flex items-center gap-2 text-sm font-medium text-neutral-900"><Icon className="h-4 w-4" /> {label}
                {active && <CheckCircle2 className="ml-auto h-4 w-4" />}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Security */

function SecurityPanel({ email }: { email: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validatePasswordChange(current, next, confirm);
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    try {
      const supabase = createClient();
      // Re-authenticate with the current password before changing it.
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (authError) { setErrors({ current: 'Current password is incorrect.' }); return; }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setCurrent(''); setNext(''); setConfirm('');
      toast.success('Password updated', { description: 'Use your new password next time you sign in.' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not update your password');
    } finally {
      setBusy(false);
    }
  }

  const field = (id: 'current' | 'next' | 'confirm', label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div>
      <label htmlFor={`pw-${id}`} className="label">{label}</label>
      <input id={`pw-${id}`} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value}
        onChange={(e) => { set(e.target.value); if (errors[id]) setErrors((x) => ({ ...x, [id]: undefined })); }}
        aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `pw-${id}-error` : undefined}
        className={clsx('input', errors[id] && 'border-red-400 focus:border-red-600 focus:ring-red-600')} />
      {errors[id] && <p id={`pw-${id}-error`} className="mt-1.5 text-xs text-red-600">{errors[id]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="max-w-md space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">Change password</h3>
        <p className="mt-1 text-sm text-neutral-500">At least 10 characters, with upper &amp; lower case letters or a number and a symbol.</p>
      </div>
      {field('current', 'Current password', current, setCurrent, 'current-password')}
      {field('next', 'New password', next, setNext, 'new-password')}
      {next && (
        <div className="-mt-3 flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1">
            {[1, 2, 3].map((i) => (
              <span key={i} className={clsx('h-1 flex-1 rounded-full transition-colors',
                strength.score >= i ? ['bg-red-500', 'bg-amber-500', 'bg-emerald-500'][strength.score - 1] : 'bg-neutral-200')} />
            ))}
          </div>
          <span className="text-xs text-neutral-500">{strength.label}</span>
        </div>
      )}
      {field('confirm', 'Confirm new password', confirm, setConfirm, 'new-password')}

      <label className="flex items-center gap-2 text-sm text-neutral-600">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} Show passwords
      </label>

      {formError && <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{formError}</p>}
      <button type="submit" disabled={busy} className="btn-primary">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Update password
      </button>
    </form>
  );
}
