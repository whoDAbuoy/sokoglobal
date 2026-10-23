-- =============================================================================
-- SokoGlobal — Migration 029: more display currencies. Run after 028. Re-runnable.
--
--  * The header switcher gains NGN, ZAR, EUR and GBP, and a signed-in visitor
--    who has not picked a currency sees their profile country's (lib/currency.ts
--    COUNTRY_CURRENCY). Display only: escrow and every charge stay in USD.
--  * Starting rates (KES per 1 unit) match FALLBACK_RATES in lib/currency.ts.
--    Super admins keep them current in Control → Exchange rates
--    (super_set_exchange_rate, migration 021). Existing rows are left alone.
-- =============================================================================

insert into public.exchange_rates (currency_code, rate_to_kes) values
  ('NGN', 0.0891), ('ZAR', 7.39), ('EUR', 150.0), ('GBP', 172.0)
on conflict (currency_code) do nothing;
