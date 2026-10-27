-- =============================================================================
-- SokoGlobal — Migration 039: on/off switches for card (Paystack) and M-Pesa escrow payments. Run after 038.
-- Re-runnable.
--
-- DPO Pay, PayPal, Airtel Money, SWIFT wire and crypto could already be switched off from
-- /admin/financials; card and M-Pesa could not. Launching with only the channels tested live needs
-- every channel switchable:
--  * platform_settings.enable_card / enable_mpesa (default on: nothing changes until an admin turns one off).
--  * super_set_payment_settings() accepts both (same validation and audit as the other switches; the
--    audit's flags array gains them at the end).
--  * gateway_enabled('paystack') follows enable_card.
--  * Postgres refuses new attempts while a channel is off: a card attempt for an order, cart or group-buy
--    pledge (subscriptions and RFQ add-ons are platform purchases and stay on card), and any M-Pesa attempt.
--    Attempts already started still settle, so switching off never strands a buyer's money.
-- =============================================================================

alter table public.platform_settings
  add column if not exists enable_card  boolean not null default true,
  add column if not exists enable_mpesa boolean not null default true;

create or replace function public.super_set_payment_settings(p jsonb, p_ip text default null, p_ua text default null)
returns public.platform_settings language plpgsql security definer set search_path = public as $$
declare
  v_old public.platform_settings; v public.platform_settings;
  k text; s text; b jsonb; w jsonb;
  c_flags constant text[] := array['enable_card', 'enable_mpesa', 'enable_dpo_pay', 'enable_airtel_money', 'enable_paypal', 'enable_swift_wire', 'enable_crypto'];
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Settings must be a JSON object'; end if;
  for k in select jsonb_object_keys(p) loop
    if k = any (c_flags) then
      if jsonb_typeof(p -> k) <> 'boolean' then raise exception '% must be true or false', k; end if;
    elsif k not in ('swift_bank_details', 'crypto_deposit_wallets', 'crypto_markup_percent') then
      raise exception 'Unknown payment setting %', k;
    end if;
  end loop;
  select * into v_old from public.platform_settings where id for update;
  if not found then raise exception 'Platform settings row is missing (run migration 014)'; end if;

  b := v_old.swift_bank_details;
  if p ? 'swift_bank_details' then
    if jsonb_typeof(p -> 'swift_bank_details') <> 'object' then raise exception 'Bank details must be an object'; end if;
    for k in select jsonb_object_keys(p -> 'swift_bank_details') loop
      if k not in ('bank_name', 'swift_code', 'account_number', 'account_name', 'routing_number', 'bank_address') then raise exception 'Unknown bank field %', k; end if;
      if jsonb_typeof(p -> 'swift_bank_details' -> k) <> 'string' then raise exception '% must be text', replace(k, '_', ' '); end if;
      s := btrim(p -> 'swift_bank_details' ->> k);
      if char_length(s) > (case when k = 'bank_address' then 300 else 120 end) then raise exception '% is too long', replace(k, '_', ' '); end if;
      if k = 'swift_code' then s := upper(s); end if;
      if k = 'swift_code' and s <> '' and s !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then raise exception 'SWIFT/BIC must be 8 or 11 letters and digits'; end if;
      if k = 'account_number' and s <> '' and s !~ '^[A-Za-z0-9 -]{4,40}$' then raise exception 'Account number / IBAN: 4–40 letters, digits, spaces or dashes'; end if;
      if k = 'routing_number' and s <> '' and s !~ '^[A-Za-z0-9 -]{3,20}$' then raise exception 'Routing / sort code: 3–20 letters or digits'; end if;
      b := b || jsonb_build_object(k, s);
    end loop;
  end if;

  w := v_old.crypto_deposit_wallets;
  if p ? 'crypto_deposit_wallets' then
    if jsonb_typeof(p -> 'crypto_deposit_wallets') <> 'object' then raise exception 'Wallets must be an object'; end if;
    for k in select jsonb_object_keys(p -> 'crypto_deposit_wallets') loop
      if k not in ('usdt_trc20', 'usdt_erc20', 'usdc_polygon') then raise exception 'Unknown wallet %', k; end if;
      if jsonb_typeof(p -> 'crypto_deposit_wallets' -> k) <> 'string' then raise exception '% must be text', k; end if;
      s := btrim(p -> 'crypto_deposit_wallets' ->> k);
      if k = 'usdt_trc20' and s <> '' and s !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then raise exception 'TRC-20 address must start with T and be 34 characters'; end if;
      if k <> 'usdt_trc20' and s <> '' and s !~ '^0x[0-9a-fA-F]{40}$' then raise exception '% address must be 0x followed by 40 hex characters', upper(split_part(k, '_', 2)); end if;
      w := w || jsonb_build_object(k, s);
    end loop;
  end if;

  if p ? 'crypto_markup_percent' then
    if jsonb_typeof(p -> 'crypto_markup_percent') <> 'number' then raise exception 'Crypto fee must be a number'; end if;
    if (p ->> 'crypto_markup_percent')::numeric not between 0 and 0.05
       or (p ->> 'crypto_markup_percent')::numeric <> round((p ->> 'crypto_markup_percent')::numeric, 4) then
      raise exception 'Crypto fee must be between 0%% and 5%% (at most two decimals)';
    end if;
  end if;

  update public.platform_settings
     set enable_card           = coalesce((p ->> 'enable_card')::boolean, enable_card),
         enable_mpesa          = coalesce((p ->> 'enable_mpesa')::boolean, enable_mpesa),
         enable_dpo_pay        = coalesce((p ->> 'enable_dpo_pay')::boolean, enable_dpo_pay),
         enable_airtel_money   = coalesce((p ->> 'enable_airtel_money')::boolean, enable_airtel_money),
         enable_paypal         = coalesce((p ->> 'enable_paypal')::boolean, enable_paypal),
         enable_swift_wire     = coalesce((p ->> 'enable_swift_wire')::boolean, enable_swift_wire),
         enable_crypto         = coalesce((p ->> 'enable_crypto')::boolean, enable_crypto),
         swift_bank_details    = b,
         crypto_deposit_wallets = w,
         crypto_markup_percent = coalesce((p ->> 'crypto_markup_percent')::numeric, crypto_markup_percent),
         payments_updated_at = now(), updated_at = now()
   where id returning * into v;
  perform public.write_admin_audit('platform.payments', 'platform', 'payments', jsonb_build_object(
    'from', jsonb_build_object('flags', jsonb_build_array(v_old.enable_dpo_pay, v_old.enable_airtel_money, v_old.enable_paypal, v_old.enable_swift_wire, v_old.enable_crypto, v_old.enable_card, v_old.enable_mpesa),
                               'swift_bank_details', v_old.swift_bank_details, 'crypto_deposit_wallets', v_old.crypto_deposit_wallets, 'crypto_markup_percent', v_old.crypto_markup_percent),
    'to', jsonb_build_object('flags', jsonb_build_array(v.enable_dpo_pay, v.enable_airtel_money, v.enable_paypal, v.enable_swift_wire, v.enable_crypto, v.enable_card, v.enable_mpesa),
                             'swift_bank_details', v.swift_bank_details, 'crypto_deposit_wallets', v.crypto_deposit_wallets, 'crypto_markup_percent', v.crypto_markup_percent)),
    p_ip, p_ua);
  return v;
end $$;

revoke all on function public.super_set_payment_settings(jsonb, text, text) from public, anon;
grant execute on function public.super_set_payment_settings(jsonb, text, text) to authenticated;

create or replace function public.gateway_enabled(p_provider text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case p_provider when 'dpo' then enable_dpo_pay when 'paypal' then enable_paypal
                                          when 'airtel_money' then enable_airtel_money when 'paystack' then enable_card end
                     from public.platform_settings where id), p_provider = 'paystack')
$$;
grant execute on function public.gateway_enabled(text) to anon, authenticated;

-- Runs inside the begin_*_payment functions' insert, so their callers get this message.
create or replace function public.payment_channel_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'card_payments' then
    if new.provider = 'paystack' and new.kind in ('order', 'group', 'pool')
       and not coalesce((select enable_card from public.platform_settings where id), true) then
      raise exception 'Card payments are turned off right now. Please choose another payment method.' using errcode = '55000';
    end if;
  elsif not coalesce((select enable_mpesa from public.platform_settings where id), true) then
    raise exception 'M-Pesa is turned off right now. Please choose another payment method.' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.payment_channel_guard() from public, anon, authenticated;

drop trigger if exists card_payments_channel_guard on public.card_payments;
create trigger card_payments_channel_guard before insert on public.card_payments
  for each row execute function public.payment_channel_guard();
drop trigger if exists mpesa_payments_channel_guard on public.mpesa_payments;
create trigger mpesa_payments_channel_guard before insert on public.mpesa_payments
  for each row execute function public.payment_channel_guard();
