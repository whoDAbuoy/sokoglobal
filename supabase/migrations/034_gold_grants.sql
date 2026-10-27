-- =============================================================================
-- SokoGlobal — Migration 034: complimentary Gold Supplier grants. Run after 033. Re-runnable.
--
--  * super_grant_gold(email, months, reason): a super admin gives a supplier Gold for 1–24 months
--    without a charge. Like paying, it extends a period that is still running, otherwise it starts
--    now. No card payment is recorded, so platform revenue is unchanged.
--  * super_revoke_gold(email, reason): ends Gold now (status canceled). Paid time is not refunded.
--  * Both: super admins only (is_super_admin(), checked here from the caller's session), suppliers
--    only, a reason is required, and every call writes admin_audit_logs ('subscription.gold_granted' /
--    'subscription.gold_revoked') with the previous and new period end, IP and user agent.
--    The app also requires a verified 2FA session (same gate as other financial overrides).
-- =============================================================================

-- The supplier behind an email, for the two functions below (raises a readable error otherwise).
create or replace function public.gold_target_supplier(p_email text)
returns public.profiles language plpgsql stable security definer set search_path = public as $$
declare v public.profiles;
begin
  select p.* into v from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if not found then raise exception 'No account uses that email address'; end if;
  if v.role <> 'supplier' then raise exception 'Gold Supplier is for supplier accounts; % is a % account', btrim(p_email), case v.role::text when 'importer' then 'buyer' else v.role::text end; end if;
  if coalesce(v.is_banned, false) then raise exception 'That account is suspended'; end if;
  return v;
end $$;

create or replace function public.super_grant_gold(p_email text, p_months integer, p_reason text, p_ip text default null, p_ua text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_supplier public.profiles; v_old public.subscriptions; v_new public.subscriptions;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  if p_months is null or p_months not between 1 and 24 then raise exception 'Grant between 1 and 24 months'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception 'Give a reason (5–500 characters)'; end if;
  v_supplier := public.gold_target_supplier(p_email);

  select * into v_old from public.subscriptions where user_id = v_supplier.id and plan_type = 'gold_supplier' for update;
  insert into public.subscriptions (user_id, plan_type, status, current_period_end)
  values (v_supplier.id, 'gold_supplier', 'active', now() + make_interval(months => p_months))
  on conflict (user_id, plan_type) do update
    set status = 'active',
        current_period_end = case when subscriptions.status = 'active' and subscriptions.current_period_end > now()
                                  then subscriptions.current_period_end else now() end + make_interval(months => p_months)
  returning * into v_new;

  perform public.write_admin_audit('subscription.gold_granted', 'user', v_supplier.id::text, jsonb_build_object(
    'months', p_months, 'reason', btrim(p_reason), 'previous_status', v_old.status,
    'previous_period_end', v_old.current_period_end, 'period_end', v_new.current_period_end), p_ip, p_ua);
  return jsonb_build_object('user_id', v_supplier.id, 'company_name', v_supplier.company_name,
    'period_end', v_new.current_period_end, 'previous_period_end', v_old.current_period_end);
end $$;

create or replace function public.super_revoke_gold(p_email text, p_reason text, p_ip text default null, p_ua text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_supplier public.profiles; v_old public.subscriptions;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception 'Give a reason (5–500 characters)'; end if;
  v_supplier := public.gold_target_supplier(p_email);

  select * into v_old from public.subscriptions where user_id = v_supplier.id and plan_type = 'gold_supplier' for update;
  if not found or v_old.status <> 'active' or v_old.current_period_end <= now() then
    raise exception '% does not have active Gold', v_supplier.company_name;
  end if;
  update public.subscriptions set status = 'canceled', current_period_end = now() where id = v_old.id;

  perform public.write_admin_audit('subscription.gold_revoked', 'user', v_supplier.id::text, jsonb_build_object(
    'reason', btrim(p_reason), 'previous_period_end', v_old.current_period_end), p_ip, p_ua);
  return jsonb_build_object('user_id', v_supplier.id, 'company_name', v_supplier.company_name, 'previous_period_end', v_old.current_period_end);
end $$;

revoke all on function public.gold_target_supplier(text) from public, anon, authenticated;
revoke all on function public.super_grant_gold(text, integer, text, text, text) from public, anon;
revoke all on function public.super_revoke_gold(text, text, text, text) from public, anon;
grant execute on function public.super_grant_gold(text, integer, text, text, text) to authenticated;
grant execute on function public.super_revoke_gold(text, text, text, text) to authenticated;
