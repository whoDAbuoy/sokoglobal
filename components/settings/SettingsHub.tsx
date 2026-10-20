'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { BadgeCheck, Bell, KeyRound, Palette, UserRound } from 'lucide-react';
import type { Profile } from '@/lib/types';
import type { SettingsTab } from '@/lib/settings';
import type { LatestChangeRequest } from '@/components/profile/ProfileChangeRequest';
import ProfilePanel, { type ProfileDetails, type Regional } from './ProfilePanel';
import SecurityPanel from './SecurityPanel';
import NotificationsPanel, { type NotificationPrefs } from './NotificationsPanel';
import AppearancePanel from './AppearancePanel';
import type { TwoFactorStatus } from './TwoFactorCard';

const ROLE_BADGE: Record<Profile['role'], { label: string; className: string }> = {
  importer: { label: 'Importer', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  supplier: { label: 'Supplier', className: 'border-neutral-300 bg-neutral-100 text-neutral-800' },
  admin: { label: 'Admin', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  super_admin: { label: 'Super admin', className: 'border-violet-200 bg-violet-50 text-violet-800' },
};

const TABS: Record<SettingsTab, { label: string; icon: typeof UserRound }> = {
  profile: { label: 'Profile & identity', icon: UserRound },
  security: { label: 'Security & 2FA', icon: KeyRound },
  notifications: { label: 'Notifications', icon: Bell },
  appearance: { label: 'Appearance', icon: Palette },
};

/** /dashboard/settings: one glass card, four tabs. Tab state mirrors ?tab= without a reload. */
export default function SettingsHub(props: {
  initialTab: SettingsTab; profile: Profile; email: string; memberSince: string | null; regional: Regional;
  changeRequest: LatestChangeRequest | null; details: ProfileDetails; prefs: NotificationPrefs; twoFactor: TwoFactorStatus; ready: boolean;
}) {
  const { profile, details, email } = props;
  const [tab, setTab] = useState<SettingsTab>(props.initialTab);
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const badge = ROLE_BADGE[profile.role];

  function select(next: SettingsTab) {
    setTab(next);
    window.history.replaceState(null, '', `?tab=${next}`);
  }

  return (
    <div className="card mt-8 overflow-hidden">
      <div className="flex flex-wrap items-center gap-5 border-b border-neutral-200 p-6 sm:p-8">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-neutral-900 text-xl font-semibold text-white">
          {details.avatar_url
            // eslint-disable-next-line @next/next/no-img-element -- user's own 512 px public avatar
            ? <img src={details.avatar_url} alt="" width={64} height={64} className="h-full w-full object-cover" />
            : initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold text-neutral-900">{profile.full_name}</h2>
            <span className={clsx('pill', badge.className)}>{badge.label}</span>
            {profile.kyc_verified && <span className="pill border-emerald-200 bg-emerald-50 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified business</span>}
            {props.twoFactor.enabled && <span className="pill tone-escrow"><KeyRound className="h-3.5 w-3.5" aria-hidden /> 2FA on</span>}
          </div>
          <p className="mt-1 truncate text-sm text-neutral-700">{details.designation ? `${details.designation} · ` : ''}{profile.company_name}</p>
          <p className="truncate text-sm text-neutral-600">{email}</p>
        </div>
      </div>

      {!props.ready && (
        <p role="note" className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900 sm:px-8">
          Photo, contact details, notifications and two-factor authentication switch on once the latest database update (migration 016) is applied.
        </p>
      )}

      <div role="tablist" aria-label="Settings" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-neutral-200 px-4 sm:px-6">
        {(Object.keys(TABS) as SettingsTab[]).map((t) => {
          const { label, icon: Icon } = TABS[t];
          return (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => select(t)}
              className={clsx('-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3.5 text-sm font-medium transition-colors',
                tab === t ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-600 hover:text-neutral-900')}>
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="p-6 sm:p-8">
        {tab === 'profile' && <ProfilePanel profile={profile} details={details} memberSince={props.memberSince} regional={props.regional}
          changeRequest={props.changeRequest} initials={initials} ready={props.ready} />}
        {tab === 'security' && <SecurityPanel email={email} twoFactor={props.twoFactor} />}
        {tab === 'notifications' && <NotificationsPanel prefs={props.prefs} hasPhone={!!details.phone_number} disabled={!props.ready} />}
        {tab === 'appearance' && <AppearancePanel />}
      </div>
    </div>
  );
}
