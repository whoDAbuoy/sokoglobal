'use client';

import { useActionState, type ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Building2, Globe2, Loader2, Save, UserRound, Wallet } from 'lucide-react';
import type { Profile } from '@/lib/types';
import { countryName, flag } from '@/lib/format';
import { dialCode } from '@/lib/countries';
import { isPermanentAdmin, roleAdminLevel } from '@/lib/auth/admin-access';
import { saveProfileDetails, type SettingsResult } from '@/app/dashboard/settings/actions';
import ProfileChangeRequest, { type LatestChangeRequest } from '@/components/profile/ProfileChangeRequest';
import AvatarUpload from './AvatarUpload';
import { KYC_STATUS_META, kycHome } from '@/lib/kyc';

export interface ProfileDetails { designation: string | null; phone_number: string | null; avatar_url: string | null }
export interface Regional { escrowCurrency: string; cardCurrency: string; mpesaEnabled: boolean }

export default function ProfilePanel({ profile, details, memberSince, changeRequest, initials, ready }: {
  profile: Profile; details: ProfileDetails; memberSince: string | null; changeRequest: LatestChangeRequest | null;
  initials: string; ready: boolean;
}) {
  const [state, action, pending] = useActionState<SettingsResult | null, FormData>(saveProfileDetails, null);
  const dial = dialCode(profile.country_code.toUpperCase());

  return (
    <div className="space-y-10">
      <Section title="Photo" icon={UserRound}>
        <div className="sm:col-span-2"><AvatarUpload url={details.avatar_url} initials={initials} disabled={!ready} /></div>
      </Section>

      <Section title="Identity" icon={Building2}>
        <Row label="Full name" value={profile.full_name} />
        <Row label="Legal / company name" value={profile.company_name} />
        <Row label="Member since" value={memberSince ? new Date(memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—'} />
        {profile.kyc_status && !roleAdminLevel(profile.role) && (
          <Row label="Verification (KYC)" value={<span>{KYC_STATUS_META[profile.kyc_status].label} · <Link href={kycHome(profile.role)} className="underline underline-offset-4">{profile.kyc_status === 'approved' ? 'details' : 'complete verification'}</Link></span>} />
        )}
        <div className="sm:col-span-2">
          {!isPermanentAdmin(profile)
            ? <div className="pt-4"><ProfileChangeRequest profile={profile} latest={changeRequest} /></div>
            : <p className="text-xs text-neutral-600">Admin names are changed by a super admin.</p>}
          <p className="mt-2 text-xs text-neutral-600">Name and company changes are reviewed because they’re tied to your business verification.</p>
        </div>
      </Section>

      <form action={action} className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900"><UserRound className="h-4 w-4 text-neutral-500" aria-hidden /> Contact details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="designation" className="label">Designation / job title</label>
            <input id="designation" name="designation" maxLength={80} defaultValue={details.designation ?? ''} placeholder="e.g. Head of Sourcing" className="input" disabled={!ready} />
          </div>
          <div>
            <label htmlFor="phone_number" className="label">Phone number</label>
            <input id="phone_number" name="phone_number" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} defaultValue={details.phone_number ?? ''}
              placeholder={dial ? `${dial} 712 345 678` : '+254 712 345 678'} className="input" disabled={!ready} aria-describedby="phone-hint" />
            <p id="phone-hint" className="mt-1 text-xs text-neutral-600">Saved in international format. Used for WhatsApp / SMS alerts if you turn them on.</p>
          </div>
        </div>
        {state && <p role={state.ok ? 'status' : 'alert'} className={clsx('text-sm', state.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>{state.message}</p>}
        <button disabled={pending || !ready} className="btn-primary px-4 py-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save details
        </button>
      </form>
    </div>
  );
}

/** Store / business details: region and how money moves (read-only; payout accounts live under Verification). */
export function StorePanel({ profile, regional }: { profile: Profile; regional: Regional }) {
  const code = profile.country_code.toUpperCase();
  const dial = dialCode(code);
  const isBuyer = profile.role === 'importer';
  const mpesaForYou = regional.mpesaEnabled && code === 'KE';

  return (
    <div className="space-y-10">
      <Section title={profile.role === 'supplier' ? 'Store' : 'Business'} icon={Building2}>
        <Row label="Legal / company name" value={profile.company_name} />
        {profile.role === 'supplier' && <Row label="Storefront" value={<Link href="/supplier/products" className="underline underline-offset-4">Your catalogue</Link>} />}
      </Section>

      <Section title="Region" icon={Globe2}>
        <Row label="Country" value={<span>{flag(code)} {countryName(code)}</span>} />
        <Row label="Dialing code" value={dial ? <span className="tabular-nums">{dial}</span> : '—'} />
      </Section>

      <Section title="Payments" icon={Wallet}>
        <Row label="Escrow currency" value={`${regional.escrowCurrency}: every order is priced and held in escrow in US dollars`} />
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
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Building2; children: ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900"><Icon className="h-4 w-4 text-neutral-500" aria-hidden /> {title}</h3>
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
