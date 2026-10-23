'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Loader2, Save } from 'lucide-react';
import { savePaymentSettings, type PaymentSettingsInput } from '@/app/admin/financials/actions';
import { SWIFT_FIELDS, WALLET_KEYS, swiftComplete, swiftFieldError, validWallet, type PaymentSettings } from '@/lib/payment-methods';

type Flag = keyof PaymentSettingsInput['flags'];
const FLAGS: { key: Flag; label: string; note: string; needs?: 'dpo' | 'paypal' | 'airtel' }[] = [
  { key: 'enable_airtel_money', label: 'Airtel Money', note: 'PIN prompt on the buyer’s phone (orders and carts).', needs: 'airtel' },
  { key: 'enable_dpo_pay', label: 'DPO Pay', note: 'Hosted card and mobile-money page (orders and carts).', needs: 'dpo' },
  { key: 'enable_paypal', label: 'PayPal', note: 'PayPal balance or linked card, captured in USD (orders and carts).', needs: 'paypal' },
  { key: 'enable_swift_wire', label: 'SWIFT wire', note: 'Bank transfer to the escrow account; you approve each one below.' },
  { key: 'enable_crypto', label: 'Crypto (USDT / USDC)', note: 'Stablecoin deposit to the wallets below; you approve each one. Check licensing in your markets before enabling.' },
];
const FIELD_LABEL: Record<(typeof SWIFT_FIELDS)[number], string> = {
  bank_name: 'Bank name', swift_code: 'SWIFT / BIC', account_number: 'Account number / IBAN', account_name: 'Account name (beneficiary)',
  routing_number: 'Routing / sort code (optional)', bank_address: 'Bank address (optional)',
};
const WALLET_LABEL = { usdt_trc20: 'USDT · TRON (TRC-20)', usdt_erc20: 'USDT · Ethereum (ERC-20)', usdc_polygon: 'USDC · Polygon' } as const;

function Switch({ id, on, onChange, disabled }: { id: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={id} disabled={disabled} onClick={() => onChange(!on)}
      className={clsx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50', on ? 'bg-blue-600' : 'bg-neutral-300')}>
      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-snow shadow transition-transform motion-reduce:transition-none', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

/** Payment channels (migration 028): switches, SWIFT escrow account and crypto wallets. Postgres validates and audits. */
export default function PaymentSettingsForm({ settings, configured, updatedAt }: {
  settings: PaymentSettings; configured: { dpo: boolean; paypal: boolean; airtel: boolean }; updatedAt: string | null;
}) {
  const router = useRouter();
  const [flags, setFlags] = useState<PaymentSettingsInput['flags']>({
    enable_dpo_pay: settings.enable_dpo_pay, enable_airtel_money: settings.enable_airtel_money, enable_paypal: settings.enable_paypal,
    enable_swift_wire: settings.enable_swift_wire, enable_crypto: settings.enable_crypto,
  });
  const [bank, setBank] = useState(Object.fromEntries(SWIFT_FIELDS.map((k) => [k, settings.swift_bank_details[k] ?? ''])) as PaymentSettingsInput['swift_bank_details']);
  const [wallets, setWallets] = useState({ ...settings.crypto_deposit_wallets });
  const [markup, setMarkup] = useState(String(Math.round(settings.crypto_markup_percent * 10_000) / 100));
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    if (flags.enable_crypto && !settings.enable_crypto && !window.confirm('Turn on crypto payments? Buyers will see the wallet addresses and you will approve each deposit by hand.')) return;
    const r = await savePaymentSettings({ flags, swift_bank_details: bank, crypto_deposit_wallets: wallets, crypto_markup: markup });
    (r.ok ? toast.success : toast.error)(r.message);
    if (r.ok) router.refresh();
  });
  const wireReady = swiftComplete({ ...bank });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-6">
      <fieldset disabled={pending} className="card p-5">
        <legend className="sr-only">Payment channels</legend>
        <h3 className="font-semibold text-neutral-900">Payment channels</h3>
        <p className="mt-1 text-sm text-neutral-600">Card and M-Pesa are always on when configured. A channel shows to buyers only when it is switched on <em>and</em> set up.</p>
        <ul className="mt-4 divide-y divide-neutral-200">
          {FLAGS.map((f) => {
            const keysMissing = f.needs && !configured[f.needs];
            const detailsMissing = (f.key === 'enable_swift_wire' && !wireReady) || (f.key === 'enable_crypto' && !WALLET_KEYS.some((k) => wallets[k].trim()));
            return (
              <li key={f.key} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p id={`pay-${f.key}`} className="text-sm font-medium text-neutral-900">{f.label}
                    {keysMissing && <span className="ml-2 pill tone-pending text-[11px]">API keys not set</span>}
                    {!keysMissing && detailsMissing && <span className="ml-2 pill tone-pending text-[11px]">details missing</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-600">{f.note}</p>
                </div>
                <Switch id={`pay-${f.key}`} on={flags[f.key]} onChange={(v) => setFlags((s) => ({ ...s, [f.key]: v }))} disabled={pending} />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset disabled={pending} className="card p-5">
        <legend className="sr-only">SWIFT escrow account</legend>
        <h3 className="font-semibold text-neutral-900">SWIFT escrow account</h3>
        <p className="mt-1 text-sm text-neutral-600">Shown to buyers who pay by wire, with a unique reference per order. Changes apply to new wire requests.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {SWIFT_FIELDS.map((k) => {
            const err = swiftFieldError(k, bank[k]);
            return (
              <div key={k} className={k === 'bank_address' ? 'sm:col-span-2' : undefined}>
                <label htmlFor={`bank-${k}`} className="label">{FIELD_LABEL[k]}</label>
                <input id={`bank-${k}`} value={bank[k]} onChange={(e) => setBank((b) => ({ ...b, [k]: e.target.value }))} maxLength={k === 'bank_address' ? 300 : 120}
                  className={clsx('input', (k === 'swift_code' || k === 'account_number' || k === 'routing_number') && 'font-mono')} aria-invalid={!!err || undefined} />
                {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset disabled={pending} className="card p-5">
        <legend className="sr-only">Crypto escrow wallets</legend>
        <h3 className="font-semibold text-neutral-900">Crypto escrow wallets</h3>
        <p className="mt-1 text-sm text-neutral-600">Only networks with an address are offered. Use wallets SokoGlobal controls; buyers send to them directly.</p>
        <div className="mt-4 space-y-4">
          {WALLET_KEYS.map((k) => (
            <div key={k}>
              <label htmlFor={`wallet-${k}`} className="label">{WALLET_LABEL[k]}</label>
              <input id={`wallet-${k}`} value={wallets[k]} onChange={(e) => setWallets((w) => ({ ...w, [k]: e.target.value }))} spellCheck={false}
                placeholder={k === 'usdt_trc20' ? 'T…' : '0x…'} className="input font-mono text-xs" aria-invalid={!validWallet(k, wallets[k]) || undefined} />
              {!validWallet(k, wallets[k]) && <p className="mt-1 text-xs text-red-600">{k === 'usdt_trc20' ? 'A TRON address starts with T and has 34 characters.' : 'An address is 0x followed by 40 hex characters.'}</p>}
            </div>
          ))}
          <div className="max-w-[12rem]">
            <label htmlFor="crypto-markup" className="label">Crypto handling fee (%)</label>
            <input id="crypto-markup" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} className="input tabular-nums" />
            <p className="mt-1 text-xs text-neutral-600">Added to what the buyer sends; 0–5%.</p>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-600">
          Every save is written to the audit log.
          {updatedAt && ` Last change ${new Date(updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`}
        </p>
        <button type="submit" disabled={pending} className="btn-primary px-4 py-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save payment settings
        </button>
      </div>
    </form>
  );
}
