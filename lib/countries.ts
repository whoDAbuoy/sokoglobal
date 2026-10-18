/**
 * Countries offered at signup, with international dialling codes.
 * profiles.country_code stores the ISO-3166 alpha-2 code.
 */
export const DIAL_CODES: Record<string, string> = {
  // Supplier markets
  US: '+1', GB: '+44', CA: '+1', FR: '+33', DE: '+49', IT: '+39', ES: '+34', NL: '+31', BE: '+32', SE: '+46',
  KR: '+82', JP: '+81', AE: '+971', TR: '+90', CN: '+86',
  // Importer markets
  NG: '+234', KE: '+254', GH: '+233', ZA: '+27', CI: '+225', SN: '+221', TZ: '+255', UG: '+256', RW: '+250',
  ET: '+251', CM: '+237', EG: '+20', MA: '+212', ZM: '+260', BW: '+267',
};

export const SUPPLIER_COUNTRIES = ['US', 'GB', 'CA', 'FR', 'DE', 'IT', 'ES', 'NL', 'BE', 'SE', 'KR', 'JP', 'CN', 'AE', 'TR'];
export const IMPORTER_COUNTRIES = ['NG', 'KE', 'GH', 'ZA', 'CI', 'SN', 'TZ', 'UG', 'RW', 'ET', 'CM', 'EG', 'MA', 'ZM', 'BW', 'CN'];

/** "+86" for CN; undefined for codes we don't list. */
export const dialCode = (code: string): string | undefined => DIAL_CODES[code.toUpperCase()];
