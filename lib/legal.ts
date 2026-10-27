/**
 * Facts the Terms of Trade, Escrow Agreement and Privacy Policy share (app/legal). Changing any document's
 * substance means a new LEGAL_VERSION: sign-up records the version each account accepted.
 */
export const LEGAL_ENTITY = 'SokoGlobal LLC';
export const LEGAL_STATE = 'Delaware';
export const LEGAL_EMAIL = 'legal@sokoglobal.shop';
/** Effective date of the current documents (ISO); also the version recorded at sign-up. */
export const LEGAL_VERSION = '2026-10-27';

export const LEGAL_DOCS = [
  { slug: 'terms', title: 'Terms of Trade', href: '/legal/terms' },
  { slug: 'escrow', title: 'Escrow Agreement', href: '/legal/escrow' },
  { slug: 'privacy', title: 'Privacy Policy', href: '/legal/privacy' },
] as const;

export const legalEffectiveDate = () =>
  new Date(`${LEGAL_VERSION}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
