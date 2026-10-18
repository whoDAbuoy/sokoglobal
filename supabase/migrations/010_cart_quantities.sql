-- =============================================================================
-- SokoGlobal — Migration 010: multiple Trial Batches per cart line / order.
-- Run after 008. Re-runnable.
--
-- Quantity = number of Trial Batches. N batches of a product become ONE order
-- (one escrow, one shipment) with units, goods, freight and customs all
-- multiplied by N — priced in Postgres, never from the client.
-- The existing single-batch functions are unchanged; the app only calls these
-- overloads when a quantity is above 1.
-- =============================================================================

alter table public.orders add column if not exists batches integer not null default 1;
alter table public.orders drop constraint if exists orders_batches_range;
alter table public.orders add constraint orders_batches_range check (batches between 1 and 20);

create or replace function public.max_batches_per_line()
returns integer language sql immutable as $$ select 20 $$;

-- Insert one order for p_batches Trial Batches of a live product (shared by both entry points).
create or replace function public.insert_trial_order(p_product public.products, p_batches integer, p_group_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  if p_batches is null or p_batches < 1 or p_batches > public.max_batches_per_line() then
    raise exception 'Quantity must be between 1 and % Trial Batches', public.max_batches_per_line();
  end if;
  if p_product.trial_landed_cost_cents < public.trial_batch_min_cents() then
    raise exception 'Trial batch below platform minimum';
  end if;
  insert into public.orders (buyer_id, product_id, order_type, quantity, batches,
                             goods_cents, freight_cents, customs_cents, checkout_group_id)
  values (auth.uid(), p_product.id, 'trial', p_product.trial_units * p_batches, p_batches,
          p_product.trial_goods_cents * p_batches, p_product.trial_freight_cents * p_batches,
          p_product.trial_customs_cents * p_batches, p_group_id)
  returning * into v_order;
  return v_order;
end $$;
revoke execute on function public.insert_trial_order(public.products, integer, uuid) from public, anon, authenticated;

-- Direct "buy now" with a quantity. Overload of create_trial_order(uuid).
create or replace function public.create_trial_order(p_product_id uuid, p_batches integer)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_product public.products;
begin
  if not public.current_role_is('importer') then
    raise exception 'Only African Importer accounts can place orders' using errcode = '42501';
  end if;
  select * into v_product from public.products where id = p_product_id and status = 'live';
  if not found then raise exception 'Product is not available' using errcode = 'P0002'; end if;
  return public.insert_trial_order(v_product, p_batches, null);
end $$;

-- Cart with quantities. Overload of create_cart_checkout(uuid[]).
create or replace function public.create_cart_checkout(p_product_ids uuid[], p_quantities integer[])
returns public.checkout_groups language plpgsql security definer set search_path = public as $$
declare
  v_group   public.checkout_groups;
  v_product public.products;
  v_n       integer := coalesce(array_length(p_product_ids, 1), 0);
begin
  if not public.current_role_is('importer') then
    raise exception 'Only African Importer accounts can place orders' using errcode = '42501';
  end if;
  if v_n = 0 then raise exception 'Your cart is empty'; end if;
  if v_n > 10 then raise exception 'A cart can hold at most 10 Trial Batches'; end if;
  if coalesce(array_length(p_quantities, 1), 0) <> v_n then raise exception 'Each cart item needs a quantity'; end if;
  if (select count(distinct x) from unnest(p_product_ids) x) <> v_n or array_position(p_product_ids, null) is not null then
    raise exception 'Each product can appear only once in a cart';
  end if;

  insert into public.checkout_groups (buyer_id) values (auth.uid()) returning * into v_group;
  for i in 1 .. v_n loop
    select * into v_product from public.products where id = p_product_ids[i] and status = 'live';
    if not found then
      raise exception 'One of the products in your cart is no longer available — remove it and try again' using errcode = 'P0002';
    end if;
    perform public.insert_trial_order(v_product, p_quantities[i], v_group.id);
  end loop;
  return v_group;
end $$;

do $$
declare f text;
begin
  foreach f in array array['create_trial_order(uuid, integer)', 'create_cart_checkout(uuid[], integer[])'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
