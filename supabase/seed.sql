-- Demo data. Prerequisite: sign up ONE "Western Supplier" account through the
-- app first, then run this in the SQL editor (it runs as the service role).

do $$
declare
  v_supplier uuid;
  p_skincare uuid; p_lipstick uuid; p_denim uuid; p_ankara uuid;
begin
  select id into v_supplier from public.profiles where role = 'supplier' order by created_at limit 1;
  if v_supplier is null then
    raise exception 'Create a supplier account in the app before seeding';
  end if;
  update public.profiles set kyc_verified = true where id = v_supplier;

  insert into public.products (supplier_id, category, title, brand, description, origin_country, attributes,
    unit_price_cents, lead_time_days, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
  values
    (v_supplier, 'beauty', 'Hydrating Snail Mucin Essence 100ml', 'Seoul Lab', 'Best-selling hydrating essence, sealed retail units.', 'KR',
     '{"skin_types":["all"],"shelf_life_months":24,"certifications":["KFDA"]}', 680, 9, 48, 32640, 11200, 6700, 'live'),
    (v_supplier, 'beauty', 'Matte Lip Colour — Deep Tones Collection', 'Maison Rouge', '12 shades formulated for melanin-rich skin.', 'FR',
     '{"shade_range":"12 shades (deep/rich)","shelf_life_months":30}', 420, 12, 96, 40320, 6400, 5280, 'live'),
    (v_supplier, 'clothing', 'Premium Stretch Denim — Mixed Sizes', 'Atlantic Denim Co.', 'Mid-rise stretch denim, size run 6–18.', 'US',
     '{"sizes":["6","8","10","12","14","16","18"],"materials":"98% cotton, 2% elastane"}', 1450, 14, 30, 43500, 9800, 7200, 'live'),
    (v_supplier, 'clothing', 'Linen Resort Shirts — Unisex', 'Brighton & Vale', 'Breathable linen, 5 colourways.', 'GB',
     '{"sizes":["S","M","L","XL"],"materials":"100% linen"}', 1100, 10, 36, 39600, 7600, 5400, 'live');

  select id into p_skincare from public.products where title like 'Hydrating Snail%' and supplier_id = v_supplier;
  select id into p_lipstick from public.products where title like 'Matte Lip%'       and supplier_id = v_supplier;
  select id into p_denim    from public.products where title like 'Premium Stretch%' and supplier_id = v_supplier;

  insert into public.trend_pools (product_id, title, description, destination_country, target_cents, pledged_cents,
    min_contribution_cents, freight_total_cents, volume_cbm, member_count, max_members, deadline)
  values
    (p_skincare, 'Korean Skincare Batch — Lagos', 'Full pallet of K-beauty best-sellers, consolidated to Lagos.', 'NG',
     1000000, 800000, 25000, 180000, 2.4, 14, 25, now() + interval '6 days'),
    (p_lipstick, 'Deep-Tone Lip Colour Pool — Nairobi', 'French lip colour, 12 shades, shared air freight to JKIA.', 'KE',
     600000, 312000, 15000, 96000, 1.1, 9, 20, now() + interval '11 days'),
    (p_denim, 'US Denim Wholesale Pool — Accra', 'Mixed size runs; split volumetric freight by contribution.', 'GH',
     1500000, 1335000, 30000, 260000, 4.8, 21, 30, now() + interval '3 days');
end $$;
