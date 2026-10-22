-- =============================================================================
-- SokoGlobal — Migration 009: buyer ↔ supplier real-time chat. Run after 008.
-- Re-runnable.
--
-- One thread per (product, buyer). Only the two participants can read a
-- thread or post in it (RLS); the supplier is always the product's supplier,
-- never chosen by the client. Messages stream via Supabase Realtime, which
-- applies the same RLS to every subscriber.
-- =============================================================================

create table if not exists public.chat_threads (
  id          uuid primary key default gen_random_uuid(),
  -- set null: a hard-deleted product (admin moderation) keeps its conversation history.
  product_id  uuid references public.products (id) on delete set null,
  buyer_id    uuid not null references public.profiles (id) on delete cascade,
  supplier_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chat_threads_distinct_parties check (buyer_id <> supplier_id),
  constraint chat_threads_one_per_buyer_product unique (product_id, buyer_id)
);
create index if not exists chat_threads_buyer_idx    on public.chat_threads (buyer_id, updated_at desc);
create index if not exists chat_threads_supplier_idx on public.chat_threads (supplier_id, updated_at desc);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.chat_threads (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  content    text not null check (char_length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at);
create index if not exists chat_messages_unread_idx on public.chat_messages (thread_id, sender_id) where read_at is null;

-- Participant check used by the policies (SECURITY DEFINER: no RLS recursion).
create or replace function public.is_chat_participant(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_threads t
                  where t.id = p_thread_id and (select auth.uid()) in (t.buyer_id, t.supplier_id))
$$;
revoke execute on function public.is_chat_participant(uuid) from public, anon;
grant  execute on function public.is_chat_participant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: participants only
-- ---------------------------------------------------------------------------
alter table public.chat_threads  enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat_threads: participants read"   on public.chat_threads;
drop policy if exists "chat_threads: buyer starts"        on public.chat_threads;
drop policy if exists "chat_messages: participants read"  on public.chat_messages;
drop policy if exists "chat_messages: participants send"  on public.chat_messages;

create policy "chat_threads: participants read" on public.chat_threads for select to authenticated
  using ((select auth.uid()) in (buyer_id, supplier_id));
-- An importer may open a thread about a live product, with that product's supplier only.
create policy "chat_threads: buyer starts" on public.chat_threads for insert to authenticated
  with check (
    buyer_id = (select auth.uid())
    and (select public.current_role_is('importer'))
    and exists (select 1 from public.products p
                 where p.id = product_id and p.status = 'live' and p.supplier_id = chat_threads.supplier_id)
  );

create policy "chat_messages: participants read" on public.chat_messages for select to authenticated
  using (public.is_chat_participant(thread_id));
create policy "chat_messages: participants send" on public.chat_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.is_chat_participant(thread_id));

-- Column-level: clients can't set ids, timestamps or read receipts, and can't edit/delete.
revoke insert, update, delete on public.chat_threads  from authenticated, anon;
revoke insert, update, delete on public.chat_messages from authenticated, anon;
grant insert (product_id, buyer_id, supplier_id) on public.chat_threads  to authenticated;
grant insert (thread_id, sender_id, content)     on public.chat_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: anti-spam limit, thread bump
-- ---------------------------------------------------------------------------
create or replace function public.chat_message_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.content := btrim(new.content);
  if (select count(*) from public.chat_messages
       where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too quickly. Please wait a moment.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists chat_message_guard on public.chat_messages;
create trigger chat_message_guard before insert on public.chat_messages
  for each row execute function public.chat_message_guard();

create or replace function public.chat_thread_bump()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chat_threads set updated_at = new.created_at where id = new.thread_id;
  return new;
end $$;
drop trigger if exists chat_thread_bump on public.chat_messages;
create trigger chat_thread_bump after insert on public.chat_messages
  for each row execute function public.chat_thread_bump();

revoke execute on function public.chat_message_guard() from public, anon, authenticated;
revoke execute on function public.chat_thread_bump()   from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions used by the UI
-- ---------------------------------------------------------------------------
-- Get or create the caller's thread about a product (buyers only).
create or replace function public.start_chat_thread(p_product_id uuid)
returns public.chat_threads language plpgsql security definer set search_path = public as $$
declare v_supplier uuid; v_thread public.chat_threads;
begin
  if not public.current_role_is('importer') then
    raise exception 'Only importer accounts can message suppliers' using errcode = '42501';
  end if;
  select * into v_thread from public.chat_threads where product_id = p_product_id and buyer_id = auth.uid();
  if found then return v_thread; end if;

  select supplier_id into v_supplier from public.products where id = p_product_id and status = 'live';
  if not found then raise exception 'This product is not available' using errcode = 'P0002'; end if;

  insert into public.chat_threads (product_id, buyer_id, supplier_id)
  values (p_product_id, auth.uid(), v_supplier)
  on conflict (product_id, buyer_id) do nothing;
  select * into v_thread from public.chat_threads where product_id = p_product_id and buyer_id = auth.uid();
  return v_thread;
end $$;

-- Mark the other party's messages in a thread as read. Returns how many changed.
create or replace function public.mark_chat_read(p_thread_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_chat_participant(p_thread_id) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;
  update public.chat_messages set read_at = now()
   where thread_id = p_thread_id and sender_id <> auth.uid() and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Inbox: the caller's threads with product, counterpart, last message and unread count.
-- SECURITY DEFINER so a supplier sees the buyer's company name (profiles RLS hides importers).
-- Return type changes in 024 (+ order_id): drop first so this file can be re-run after 024 (else 42P13).
drop function if exists public.my_chat_threads();
create or replace function public.my_chat_threads()
returns table (
  thread_id uuid, product_id uuid, product_title text, my_role text,
  counterpart_id uuid, counterpart_name text,
  last_message text, last_message_at timestamptz, last_sender_id uuid, unread_count integer, updated_at timestamptz
) language sql stable security definer set search_path = public as $$
  select t.id, t.product_id, coalesce(p.title, 'Removed product'),
         case when t.buyer_id = auth.uid() then 'buyer' else 'supplier' end,
         c.id, coalesce(c.company_name, 'SokoGlobal user'),
         lm.content, lm.created_at, lm.sender_id,
         (select count(*)::int from public.chat_messages m
           where m.thread_id = t.id and m.sender_id <> auth.uid() and m.read_at is null),
         t.updated_at
    from public.chat_threads t
    left join public.products p on p.id = t.product_id
    join public.profiles c on c.id = case when t.buyer_id = auth.uid() then t.supplier_id else t.buyer_id end
    left join lateral (select m.content, m.created_at, m.sender_id from public.chat_messages m
                        where m.thread_id = t.id order by m.created_at desc limit 1) lm on true
   where auth.uid() in (t.buyer_id, t.supplier_id)
   order by t.updated_at desc
   limit 200
$$;

create or replace function public.chat_unread_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.chat_messages m
    join public.chat_threads t on t.id = m.thread_id
   where auth.uid() in (t.buyer_id, t.supplier_id) and m.sender_id <> auth.uid() and m.read_at is null
$$;

do $$
declare f text;
begin
  foreach f in array array['start_chat_thread(uuid)', 'mark_chat_read(uuid)', 'my_chat_threads()', 'chat_unread_count()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Realtime: stream message inserts; Supabase filters them per subscriber with the RLS above.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
exception when duplicate_object then null; end $$;
