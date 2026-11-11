'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { BadgeCheck, Bell, KeyRound, Palette, Store, UserRound } from 'lucide-react';
import type { Profile } from '@/lib/types';
import { SETTINGS_TABS, type SettingsTab } from '@/lib/settings';
import type { LatestChangeRequest } from '@/components/profile/ProfileChangeRequest';
import ProfilePanel, { StorePanel, type ProfileDetails, type Regional } from './ProfilePanel';
import SecurityPanel from './SecurityPanel';
import NotificationsPanel, { type NotificationPrefs } from './NotificationsPanel';
import AppearancePanel from './AppearancePanel';
import type { TwoFactorStatus } from './TwoFactorCard';

// Sellsy pills (globals.css `sx-pill-*`): the page is always dark, so tones are fixed rather than themed.
const ROLE_BADGE: Record<Profile['role'], { label: string; className: string }> = {
  importer: { label: 'Importer', className: 'sx-pill-muted' },
  supplier: { label: 'Supplier', className: 'sx-pill-muted' },
  admin: { label: 'Admin', className: 'sx-pill-amber' },
  super_admin: { label: 'Super admin', className: 'sx-pill-blue' },
};

const TABS: Record<SettingsTab, { label: (role: Profile['role']) => string; icon: typeof UserRound }> = {
  profile: { label: () => 'Account info', icon: UserRound },
  security: { label: () => 'Security', icon: KeyRound },
  store: { label: (role) => (role === 'supplier' ? 'Store details' : 'Business details'), icon: Store },
  notifications: { label: () => 'Notifications', icon: Bell },
  appearance: { label: () => 'Appearance', icon: Palette },
};

/**
 * /dashboard/settings (Sellsy layout): an identity card with mint status pills, white pill tabs, and the
 * active section in its own charcoal card. Tab state mirrors ?tab= without a reload.
 */
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
    <div className="mt-8 space-y-4">
      <div className="sx-card flex flex-wrap items-center gap-5 p-6 sm:p-8">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-[#5a9895]/25 text-xl font-semibold text-[#8fd3cc] ring-1 ring-snow/10">
          {details.avatar_url
            // eslint-disable-next-line @next/next/no-img-element -- user's own 512 px public avatar
            ? <img src={details.avatar_url} alt="" width={64} height={64} className="h-full w-full object-cover" />
            : initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold text-neutral-900">{profile.full_name}</h2>
            <span className={clsx('sx-pill', badge.className)}>{badge.label}</span>
            {profile.kyc_verified && (
              <span className="sx-pill sx-pill-mint"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {profile.role === 'supplier' ? 'Verified supplier' : 'Verified business'}</span>
            )}
            {props.twoFactor.enabled && <span className="sx-pill sx-pill-mint"><KeyRound className="h-3.5 w-3.5" aria-hidden /> 2FA active</span>}
          </div>
          <p className="mt-1 truncate text-sm text-neutral-700">{details.designation ? `${details.designation} · ` : ''}{profile.company_name}</p>
          <p className="truncate text-sm text-neutral-600">{email}</p>
        </div>
      </div>

      {!props.ready && (
        <p role="note" className="rounded-3xl bg-amber-400/10 px-6 py-3 text-sm text-amber-200 sm:px-8">
          Photo, contact details, notifications and two-factor authentication switch on once the latest database update (migration 016) is applied.
        </p>
      )}

      <div role="tablist" aria-label="Settings" data-tour="settings-tabs" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
        {SETTINGS_TABS.map((t) => {
          const { label, icon: Icon } = TABS[t];
          return (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => select(t)}
              className="sx-tab press">
              <Icon className="h-4 w-4" aria-hidden /> {label(profile.role)}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="sx-card p-6 sm:p-8">
        {tab === 'profile' && <ProfilePanel profile={profile} details={details} memberSince={props.memberSince}
          changeRequest={props.changeRequest} initials={initials} ready={props.ready} />}
        {tab === 'security' && <SecurityPanel email={email} twoFactor={props.twoFactor} />}
        {tab === 'store' && <StorePanel profile={profile} regional={props.regional} />}
        {tab === 'notifications' && <NotificationsPanel prefs={props.prefs} hasPhone={!!details.phone_number} disabled={!props.ready} />}
        {tab === 'appearance' && <AppearancePanel />}
      </div>
    </div>
  );
}
