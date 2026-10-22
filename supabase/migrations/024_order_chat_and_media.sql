-- =============================================================================
-- SokoGlobal — Migration 024: order chat with rich media (images, video,
-- documents, voice notes). Run after 023. Re-runnable.
--
-- Builds on the buyer ↔ supplier chat from migration 009 instead of adding a
-- second chat system (public.chat_messages already exists there):
--  * chat_threads.order_id — one thread per order, between the order's buyer
--    and the supplier of its product. Product threads (order_id null) keep
--    working; a buyer can have both for the same product.
--  * Order chat opens once the order is paid (orders.fulfillment_status is not
--    awaiting_payment / void), the same rule that lets suppliers see orders at
--    all (migration 018). start_order_chat() gets or creates the thread.
--  * chat_messages.message_type ('text' | 'image' | 'video' | 'document' |
--    'voice_note') + metadata. For attachments, content is the object path in
--    the private chat-attachments bucket: "<order_id>/<sender_id>/<file>".
--    A trigger checks the path belongs to this order and sender, that the file
--    was actually uploaded, and rebuilds metadata from the stored object
--    (size + MIME type come from Storage, not from the client).
--  * Storage: private bucket, 50 MB per file, allow-listed MIME types; only the
--    order's buyer and supplier can upload (into their own folder) or read.
--  * Realtime: chat_messages is already published (009); kept idempotent here.
-- =============================================================================

-- ── 1. Order threads ────────────────────────────────────────────────────────
alter table public.chat_threads add column if not exists order_id uuid references public.orders (id) on delete cascade;

-- "One thread per buyer and product" now applies to product threads only.
alter table public.chat_threads drop constraint if exists chat_threads_one_per_buyer_product;
create unique index if not exists chat_threads_product_uniq on public.chat_threads (product_id, buyer_id) where order_id is null;
create unique index if not exists chat_threads_order_uniq on public.chat_threads (order_id) where order_id is not null;

-- Buyer or supplier of a paid order (SECURITY DEFINER: suppliers can't read unpaid orders under RLS).
create or replace function public.is_order_chat_participant(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o join public.products p on p.id = o.product_id
     where o.id = p_order_id and (select auth.uid()) in (o.buyer_id, p.supplier_id)
       and o.fulfillment_status not in ('awaiting_payment', 'void'))
$$;

-- Same as 009, but only ever reuses / creates the product thread (order_id is null).
create or replace function public.start_chat_thread(p_product_id uuid)
returns public.chat_threads language plpgsql security definer set search_path = public as $$
declare v_supplier uuid; v_thread public.chat_threads;
begin
  if not public.current_role_is('importer') then
    raise exception 'Only importer accounts can message suppliers' using errcode = '42501';
  end if;
  select * into v_thread from public.chat_threads where product_id = p_product_id and buyer_id = auth.uid() and order_id is null;
  if found then return v_thread; end if;

  select supplier_id into v_supplier from public.products where id = p_product_id and status = 'live';
  if not found then raise exception 'This product is not available' using errcode = 'P0002'; end if;

  insert into public.chat_threads (product_id, buyer_id, supplier_id)
  values (p_product_id, auth.uid(), v_supplier)
  on conflict (product_id, buyer_id) where order_id is null do nothing;
  select * into v_thread from public.chat_threads where product_id = p_product_id and buyer_id = auth.uid() and order_id is null;
  return v_thread;
end $$;

-- Get or create the chat for an order. Either party may open it.
create or replace function public.start_order_chat(p_order_id uuid)
returns public.chat_threads language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_supplier uuid; v_thread public.chat_threads;
begin
  if not public.is_order_chat_participant(p_order_id) then
    raise exception 'Order chat opens once the order is paid, for its buyer and supplier only' using errcode = '42501';
  end if;
  select * into v_thread from public.chat_threads where order_id = p_order_id;
  if found then return v_thread; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id;
  select supplier_id into v_supplier from public.products where id = v_order.product_id;
  insert into public.chat_threads (product_id, buyer_id, supplier_id, order_id)
  values (v_order.product_id, v_order.buyer_id, v_supplier, p_order_id)
  on conflict (order_id) where order_id is not null do nothing;
  select * into v_thread from public.chat_threads where order_id = p_order_id;
  return v_thread;
end $$;

-- ── 2. Message types + metadata ─────────────────────────────────────────────
alter table public.chat_messages add column if not exists message_type text not null default 'text';
alter table public.chat_messages add column if not exists metadata jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.chat_messages add constraint chat_messages_type_valid
    check (message_type in ('text', 'image', 'video', 'document', 'voice_note'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.chat_messages add constraint chat_messages_metadata_shape
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096);
exception when duplicate_object then null; end $$;

revoke insert on public.chat_messages from authenticated;
grant insert (thread_id, sender_id, content, message_type, metadata) on public.chat_messages to authenticated;

-- Allowed MIME types per message type (mirrored in lib/chat-media.ts and the bucket below).
create or replace function public.chat_media_mime_allowed(p_type text, p_mime text)
returns boolean language sql immutable as $$
  select case p_type
    when 'image'      then p_mime in ('image/png', 'image/jpeg', 'image/webp')
    when 'video'      then p_mime in ('video/mp4', 'video/webm')
    when 'document'   then p_mime in ('application/pdf',
                                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    when 'voice_note' then p_mime in ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg')
    else false end
$$;

create or replace function public.chat_message_media_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_order  uuid;
  v_parts  text[];
  v_obj    record;
  v_mime   text;
  v_size   bigint;
  v_dur    numeric;
  v_wave   jsonb;
  v_name   text;
begin
  if new.message_type = 'text' then
    new.metadata := '{}'::jsonb;
    return new;
  end if;

  select t.order_id into v_order from public.chat_threads t where t.id = new.thread_id;
  if v_order is null then raise exception 'Attachments can only be sent in order chats' using errcode = '22023'; end if;

  v_parts := string_to_array(new.content, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[1] <> v_order::text or v_parts[2] <> new.sender_id::text
     or v_parts[3] !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$' then
    raise exception 'Invalid attachment path' using errcode = '22023';
  end if;

  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'chat-attachments' and o.name = new.content;
  if not found then raise exception 'Attachment not found — upload the file first' using errcode = 'P0002'; end if;

  -- Size and type as Storage recorded them; the client's values are only a fallback.
  v_mime := lower(split_part(coalesce(v_obj.metadata ->> 'mimetype', new.metadata ->> 'mime_type', ''), ';', 1));
  v_size := coalesce(nullif(v_obj.metadata ->> 'size', '')::bigint, nullif(new.metadata ->> 'size', '')::bigint);
  if not public.chat_media_mime_allowed(new.message_type, v_mime) then
    raise exception 'That file type is not allowed for a % message', replace(new.message_type, '_', ' ') using errcode = '22023';
  end if;
  if v_size is null or v_size <= 0 or v_size > 52428800 then
    raise exception 'Attachments must be between 1 byte and 50 MB' using errcode = '22023';
  end if;

  if jsonb_typeof(new.metadata -> 'duration_seconds') = 'number' then
    v_dur := round((new.metadata ->> 'duration_seconds')::numeric, 1);
    -- Voice notes are capped at 10 minutes by the recorder; videos at 2 hours.
    if v_dur < 0 or v_dur > (case when new.message_type = 'voice_note' then 600 else 7200 end) then v_dur := null; end if;
  end if;
  if new.message_type = 'voice_note' and jsonb_typeof(new.metadata -> 'waveform') = 'array' and jsonb_array_length(new.metadata -> 'waveform') <= 64
     and not exists (select 1 from jsonb_array_elements(new.metadata -> 'waveform') e
                      where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric not between 0 and 100) then
    v_wave := new.metadata -> 'waveform';
  end if;
  v_name := left(regexp_replace(coalesce(new.metadata ->> 'file_name', v_parts[3]), '[[:cntrl:]<>"\\/]', '', 'g'), 200);

  new.metadata := jsonb_strip_nulls(jsonb_build_object(
    'size', v_size, 'mime_type', v_mime, 'file_name', nullif(v_name, ''), 'duration_seconds', v_dur, 'waveform', v_wave));
  return new;
end $$;
drop trigger if exists chat_message_media_guard on public.chat_messages;
create trigger chat_message_media_guard before insert on public.chat_messages
  for each row execute function public.chat_message_media_guard();
revoke execute on function public.chat_message_media_guard() from public, anon, authenticated;

-- ── 3. Inbox shows order threads and media previews (return type changes → recreate) ──
drop function if exists public.my_chat_threads();
create function public.my_chat_threads()
returns table (
  thread_id uuid, product_id uuid, product_title text, my_role text,
  counterpart_id uuid, counterpart_name text,
  last_message text, last_message_at timestamptz, last_sender_id uuid, unread_count integer, updated_at timestamptz,
  order_id uuid
) language sql stable security definer set search_path = public as $$
  select t.id, t.product_id,
         case when t.order_id is not null
              then 'Order #' || upper(left(t.order_id::text, 8)) || ' · ' || coalesce(p.title, 'Removed product')
              else coalesce(p.title, 'Removed product') end,
         case when t.buyer_id = auth.uid() then 'buyer' else 'supplier' end,
         c.id, coalesce(c.company_name, 'SokoGlobal user'),
         case lm.message_type
           when 'image' then '📷 Photo' when 'video' then '🎬 Video' when 'document' then '📄 ' || coalesce(lm.metadata ->> 'file_name', 'Document')
           when 'voice_note' then '🎤 Voice note' else lm.content end,
         lm.created_at, lm.sender_id,
         (select count(*)::int from public.chat_messages m
           where m.thread_id = t.id and m.sender_id <> auth.uid() and m.read_at is null),
         t.updated_at, t.order_id
    from public.chat_threads t
    left join public.products p on p.id = t.product_id
    join public.profiles c on c.id = case when t.buyer_id = auth.uid() then t.supplier_id else t.buyer_id end
    left join lateral (select m.content, m.created_at, m.sender_id, m.message_type, m.metadata from public.chat_messages m
                        where m.thread_id = t.id order by m.created_at desc limit 1) lm on true
   where auth.uid() in (t.buyer_id, t.supplier_id)
   order by t.updated_at desc
   limit 200
$$;

-- ── 4. Storage bucket ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 52428800, array[
  'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm',
  'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- "<order_id>/<sender_id>/<file>": the order's participants read; each uploads only into their own folder.
create or replace function public.chat_attachment_access(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_parts text[] := string_to_array(p_name, '/');
begin
  if coalesce(array_length(v_parts, 1), 0) <> 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if p_write and v_parts[2] is distinct from (select auth.uid())::text then return false; end if;
  return public.is_order_chat_participant(v_parts[1]::uuid);
end $$;

drop policy if exists "chat attachments: participants upload" on storage.objects;
create policy "chat attachments: participants upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments' and public.chat_attachment_access(name, true));
drop policy if exists "chat attachments: participants read" on storage.objects;
create policy "chat attachments: participants read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and public.chat_attachment_access(name, false));

-- ── 5. Grants + Realtime ────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.start_order_chat(uuid)', 'public.start_chat_thread(uuid)', 'public.my_chat_threads()',
                           'public.is_order_chat_participant(uuid)', 'public.chat_attachment_access(text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
exception when duplicate_object then null; end $$;
