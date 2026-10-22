-- =============================================================================
-- SokoGlobal — Migration 025: super-admin messaging, direct support threads,
-- attachments in every thread, and order chat from quote acceptance.
-- Run after 024. Re-runnable.
--
--  * chat_threads.kind: 'product' (009), 'order' (024) or 'direct' — a support
--    conversation between SokoGlobal (any super admin; one shared desk) and one
--    user (user_id). buyer_id / supplier_id are only required for product and
--    order threads. One direct thread per user.
--  * Super admins can read and post in every thread (moderation / support) and
--    delete messages. Their messages are flagged from_admin (set by a trigger,
--    never by the client) and shown with a "SokoGlobal Admin" badge; the
--    recipients also get an email / SMS (notification_queue, at most one per
--    thread per hour).
--  * Read receipts stay honest: an admin reading a buyer↔supplier thread does
--    not mark anything read; in a direct thread the desk reads the user's messages.
--  * Order chat also opens for an accepted RFQ quote before it is paid (the
--    supplier already knows the order: they quoted it). Other unpaid orders
--    still get no chat (suppliers can't see them, migration 018).
--  * Attachments: any thread may carry them. Paths are "<scope>/<sender>/<file>"
--    where scope is the order id (order threads, as in 024) or the thread id.
--    Super admins can read every attachment and upload into any thread scope
--    (still only under their own sender folder, so nobody can post as someone else).
-- =============================================================================

-- ── 1. Thread kinds and direct threads ──────────────────────────────────────
alter table public.chat_threads add column if not exists kind text;
alter table public.chat_threads add column if not exists user_id uuid references public.profiles (id) on delete cascade;
alter table public.chat_threads add column if not exists admin_id uuid references public.profiles (id) on delete set null;
update public.chat_threads set kind = case when order_id is not null then 'order' else 'product' end where kind is null;
alter table public.chat_threads alter column kind set default 'product';
alter table public.chat_threads alter column kind set not null;
alter table public.chat_threads alter column buyer_id drop not null;
alter table public.chat_threads alter column supplier_id drop not null;
do $$ begin
  alter table public.chat_threads add constraint chat_threads_kind_valid check (kind in ('product', 'order', 'direct'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.chat_threads add constraint chat_threads_parties check (
    (kind = 'direct' and user_id is not null and order_id is null)
    or (kind = 'order' and order_id is not null and buyer_id is not null and supplier_id is not null)
    or (kind = 'product' and order_id is null and buyer_id is not null and supplier_id is not null));
exception when duplicate_object then null; end $$;
create unique index if not exists chat_threads_direct_uniq on public.chat_threads (user_id) where kind = 'direct';
create index if not exists chat_threads_kind_idx on public.chat_threads (kind, updated_at desc);

-- Older callers (start_order_chat in 024) insert without a kind: derive it.
create or replace function public.chat_threads_set_kind()
returns trigger language plpgsql as $$
begin
  if new.order_id is not null then new.kind := 'order';
  elsif new.user_id is not null and new.buyer_id is null then new.kind := 'direct';
  elsif new.kind is null or new.kind = 'order' then new.kind := 'product';
  end if;
  return new;
end $$;
drop trigger if exists chat_threads_set_kind on public.chat_threads;
create trigger chat_threads_set_kind before insert on public.chat_threads for each row execute function public.chat_threads_set_kind();

-- ── 2. Who is in a thread ───────────────────────────────────────────────────
-- Participants: buyer / supplier (product, order), the user of a direct thread, and super admins (everything).
create or replace function public.is_chat_participant(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_threads t
                  where t.id = p_thread_id and (select auth.uid()) in (t.buyer_id, t.supplier_id, t.user_id))
      or public.is_super_admin()
$$;

-- The people a message in this thread is "for" (for read receipts and alerts): never an observing admin.
create or replace function public.chat_thread_members(p_thread_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select array_remove(array[t.buyer_id, t.supplier_id, t.user_id], null) from public.chat_threads t where t.id = p_thread_id
$$;

-- Order chat: paid orders, plus accepted RFQ quotes awaiting payment (both parties already know the order).
create or replace function public.is_order_chat_participant(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o join public.products p on p.id = o.product_id
     where o.id = p_order_id and (select auth.uid()) in (o.buyer_id, p.supplier_id)
       and (o.fulfillment_status not in ('awaiting_payment', 'void')
            or (o.rfq_quote_id is not null and o.fulfillment_status = 'awaiting_payment')))
$$;

drop policy if exists "chat_threads: participants read" on public.chat_threads;
create policy "chat_threads: participants read" on public.chat_threads for select to authenticated
  using (public.is_chat_participant(id));

-- Super admins may remove messages (abuse, mistakes). Nobody else can edit or delete.
grant delete on public.chat_messages to authenticated;
drop policy if exists "chat_messages: super admin deletes" on public.chat_messages;
create policy "chat_messages: super admin deletes" on public.chat_messages for delete to authenticated
  using ((select public.is_super_admin()));

-- ── 3. Admin flag + alerts ──────────────────────────────────────────────────
alter table public.chat_messages add column if not exists from_admin boolean not null default false;

create or replace function public.chat_message_admin_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.from_admin := auth.uid() is not null and new.sender_id = auth.uid() and public.is_super_admin();
  return new;
end $$;
drop trigger if exists chat_message_admin_flag on public.chat_messages;
create trigger chat_message_admin_flag before insert on public.chat_messages
  for each row execute function public.chat_message_admin_flag();

create or replace function public.notify_admin_chat_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_thread public.chat_threads; v_member uuid; v_preview text;
begin
  if not new.from_admin then return new; end if;
  select * into v_thread from public.chat_threads where id = new.thread_id;
  v_preview := case new.message_type when 'text' then left(new.content, 160) when 'voice_note' then 'sent you a voice note'
                    when 'image' then 'sent you a photo' when 'video' then 'sent you a video' else 'sent you a document' end;
  foreach v_member in array public.chat_thread_members(new.thread_id) loop
    continue when v_member = new.sender_id;
    begin
      perform public.enqueue_notification(v_member, 'support.admin_message',
        jsonb_build_object('thread_id', new.thread_id, 'kind', v_thread.kind, 'order_id', v_thread.order_id, 'preview', v_preview,
                           'role', (select role::text from public.profiles where id = v_member)),
        'adminmsg:' || new.thread_id || ':' || v_member || ':' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'));
    exception when others then
      raise warning 'admin chat notification failed for %: %', new.id, sqlerrm;
    end;
  end loop;
  return new;
end $$;
drop trigger if exists chat_message_admin_notify on public.chat_messages;
create trigger chat_message_admin_notify after insert on public.chat_messages
  for each row execute function public.notify_admin_chat_message();
revoke execute on function public.chat_message_admin_flag() from public, anon, authenticated;
revoke execute on function public.notify_admin_chat_message() from public, anon, authenticated;

-- ── 4. Attachments in every thread ──────────────────────────────────────────
create or replace function public.chat_message_media_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_thread public.chat_threads;
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

  select * into v_thread from public.chat_threads t where t.id = new.thread_id;
  v_parts := string_to_array(new.content, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3
     or v_parts[1] not in (coalesce(v_thread.order_id::text, ''), v_thread.id::text)
     or v_parts[2] <> new.sender_id::text
     or v_parts[3] !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$' then
    raise exception 'Invalid attachment path' using errcode = '22023';
  end if;

  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'chat-attachments' and o.name = new.content;
  if not found then raise exception 'Attachment not found — upload the file first' using errcode = 'P0002'; end if;

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

-- "<scope>/<sender>/<file>": scope = a thread id, or an order id (order threads, 024 paths).
create or replace function public.chat_attachment_access(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_scope uuid;
begin
  if coalesce(array_length(v_parts, 1), 0) <> 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if p_write and v_parts[2] is distinct from (select auth.uid())::text then return false; end if;
  if public.is_super_admin() then return true; end if;
  v_scope := v_parts[1]::uuid;
  if exists (select 1 from public.chat_threads where id = v_scope) then return public.is_chat_participant(v_scope); end if;
  return public.is_order_chat_participant(v_scope)
      or exists (select 1 from public.chat_threads t where t.order_id = v_scope and (select auth.uid()) in (t.buyer_id, t.supplier_id));
end $$;

-- ── 5. Read receipts and unread counts ──────────────────────────────────────
create or replace function public.mark_chat_read(p_thread_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_t public.chat_threads; v_n integer := 0;
begin
  if not public.is_chat_participant(p_thread_id) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;
  select * into v_t from public.chat_threads where id = p_thread_id;
  if auth.uid() in (v_t.buyer_id, v_t.supplier_id, v_t.user_id) then
    update public.chat_messages set read_at = now()
     where thread_id = p_thread_id and sender_id <> auth.uid() and read_at is null;
    get diagnostics v_n = row_count;
  elsif v_t.kind = 'direct' and public.is_super_admin() then
    -- The support desk read the user's messages.
    update public.chat_messages set read_at = now()
     where thread_id = p_thread_id and sender_id = v_t.user_id and read_at is null;
    get diagnostics v_n = row_count;
  end if;   -- an admin observing a buyer ↔ supplier thread marks nothing
  return v_n;
end $$;

create or replace function public.chat_unread_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.chat_messages m join public.chat_threads t on t.id = m.thread_id
   where m.read_at is null and m.sender_id <> auth.uid()
     and (auth.uid() in (t.buyer_id, t.supplier_id, t.user_id)
          or (t.kind = 'direct' and m.sender_id = t.user_id and public.is_super_admin()))
$$;

-- Header badge: total unread plus how many came from SokoGlobal admins.
create or replace function public.chat_unread_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('total', count(*), 'from_admin', count(*) filter (where m.from_admin))
    from public.chat_messages m join public.chat_threads t on t.id = m.thread_id
   where m.read_at is null and m.sender_id <> auth.uid()
     and (auth.uid() in (t.buyer_id, t.supplier_id, t.user_id)
          or (t.kind = 'direct' and m.sender_id = t.user_id and public.is_super_admin()))
$$;

-- ── 6. Inbox (return type changes → recreate) ───────────────────────────────
drop function if exists public.my_chat_threads();
create function public.my_chat_threads()
returns table (
  thread_id uuid, product_id uuid, product_title text, my_role text,
  counterpart_id uuid, counterpart_name text,
  last_message text, last_message_at timestamptz, last_sender_id uuid, unread_count integer, updated_at timestamptz,
  order_id uuid, kind text, last_from_admin boolean
) language sql stable security definer set search_path = public as $$
  select t.id, t.product_id,
         case t.kind
           when 'order' then 'Order #' || upper(left(t.order_id::text, 8)) || ' · ' || coalesce(p.title, 'Removed product')
           when 'direct' then 'Direct support'
           else coalesce(p.title, 'Removed product') end,
         case when t.kind = 'direct' then case when t.user_id = auth.uid() then 'user' else 'admin' end
              when t.buyer_id = auth.uid() then 'buyer' else 'supplier' end,
         c.id,
         case when t.kind = 'direct' and t.user_id = auth.uid() then 'SokoGlobal Support' else coalesce(c.company_name, 'SokoGlobal user') end,
         case lm.message_type
           when 'image' then '📷 Photo' when 'video' then '🎬 Video' when 'document' then '📄 ' || coalesce(lm.metadata ->> 'file_name', 'Document')
           when 'voice_note' then '🎤 Voice note' else lm.content end,
         lm.created_at, lm.sender_id,
         (select count(*)::int from public.chat_messages m
           where m.thread_id = t.id and m.read_at is null and m.sender_id <> auth.uid()
             and (auth.uid() in (t.buyer_id, t.supplier_id, t.user_id) or m.sender_id = t.user_id)),
         t.updated_at, t.order_id, t.kind, coalesce(lm.from_admin, false)
    from public.chat_threads t
    left join public.products p on p.id = t.product_id
    left join public.profiles c on c.id = case
           when t.kind = 'direct' then case when t.user_id = auth.uid() then t.admin_id else t.user_id end
           when t.buyer_id = auth.uid() then t.supplier_id else t.buyer_id end
    left join lateral (select m.content, m.created_at, m.sender_id, m.message_type, m.metadata, m.from_admin from public.chat_messages m
                        where m.thread_id = t.id order by m.created_at desc limit 1) lm on true
   where auth.uid() in (t.buyer_id, t.supplier_id, t.user_id)
      or (t.kind = 'direct' and public.is_super_admin())
   order by t.updated_at desc
   limit 200
$$;

-- ── 7. Super-admin chat center ──────────────────────────────────────────────
-- Every conversation on the platform, filterable by kind and searchable by people, product or order.
create or replace function public.admin_chat_threads(p_kind text default null, p_query text default null, p_limit integer default 100)
returns table (
  thread_id uuid, kind text, title text, order_id uuid, product_id uuid,
  buyer_name text, supplier_name text, user_id uuid, user_name text, user_role text,
  last_message text, last_message_at timestamptz, last_from_admin boolean, unread_count integer, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  return query
  select t.id, t.kind,
         case t.kind when 'order' then 'Order #' || upper(left(t.order_id::text, 8)) || ' · ' || coalesce(p.title, 'Removed product')
                     when 'direct' then 'Direct support' else coalesce(p.title, 'Removed product') end,
         t.order_id, t.product_id, b.company_name, s.company_name, t.user_id,
         coalesce(u.company_name, u.full_name), u.role::text,
         case lm.message_type when 'text' then lm.content when 'image' then '📷 Photo' when 'video' then '🎬 Video'
              when 'voice_note' then '🎤 Voice note' when 'document' then '📄 ' || coalesce(lm.metadata ->> 'file_name', 'Document') end,
         lm.created_at, coalesce(lm.from_admin, false),
         (select count(*)::int from public.chat_messages m where m.thread_id = t.id and t.kind = 'direct' and m.sender_id = t.user_id and m.read_at is null),
         t.updated_at
    from public.chat_threads t
    left join public.products p on p.id = t.product_id
    left join public.profiles b on b.id = t.buyer_id
    left join public.profiles s on s.id = t.supplier_id
    left join public.profiles u on u.id = t.user_id
    left join lateral (select m.content, m.created_at, m.message_type, m.metadata, m.from_admin from public.chat_messages m
                        where m.thread_id = t.id order by m.created_at desc limit 1) lm on true
   where (p_kind is null or p_kind = '' or t.kind = p_kind)
     and (v_q is null or concat_ws(' ', p.title, b.company_name, b.full_name, s.company_name, s.full_name, u.company_name, u.full_name,
                                   t.order_id::text) ilike '%' || v_q || '%')
   order by t.updated_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 300);
end $$;

-- Get or create the support thread with one user (shared by all super admins).
create or replace function public.start_direct_thread(p_user_id uuid)
returns public.chat_threads language plpgsql security definer set search_path = public as $$
declare v_thread public.chat_threads;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot message yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  select * into v_thread from public.chat_threads where kind = 'direct' and user_id = p_user_id;
  if found then return v_thread; end if;
  insert into public.chat_threads (kind, user_id, admin_id) values ('direct', p_user_id, auth.uid())
  on conflict (user_id) where kind = 'direct' do nothing;
  select * into v_thread from public.chat_threads where kind = 'direct' and user_id = p_user_id;
  return v_thread;
end $$;

-- ── 8. Grants + Realtime ────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.is_chat_participant(uuid)', 'public.chat_thread_members(uuid)', 'public.is_order_chat_participant(uuid)',
                           'public.chat_attachment_access(text, boolean)', 'public.mark_chat_read(uuid)', 'public.chat_unread_count()',
                           'public.chat_unread_summary()', 'public.my_chat_threads()',
                           'public.admin_chat_threads(text, text, integer)', 'public.start_direct_thread(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Realtime: under RLS a DELETE event only carries the deleted row's id, so the UI
-- listens for deletes without a thread filter and drops that id if it is on screen.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
exception when duplicate_object then null; end $$;
