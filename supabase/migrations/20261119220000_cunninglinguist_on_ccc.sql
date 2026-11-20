-- Cunning Linguist moved onto the CannonCodeConnect Supabase project (azkyohtmhlvnkziuvgvk).
-- Accounts are invite-only (project sign-ups stay off). Each account sees only its own rows.
-- Invite requests can be added by anyone, read by no one but the service role.

create table if not exists public.cl_user_progress (
  user_id         uuid not null references auth.users(id) on delete cascade,
  lang            text not null check (char_length(lang) between 2 and 8),
  current_day     integer not null default 1,
  completed_days  jsonb not null default '[]'::jsonb,
  streak          integer not null default 0,
  last_visit      text,
  mastered_vocab  jsonb not null default '{}'::jsonb,
  need_work_vocab jsonb not null default '{}'::jsonb,
  quiz_correct    integer not null default 0,
  quiz_total      integer not null default 0,
  grace_used      integer not null default 0,
  grace_month     text,
  updated_at      timestamptz not null default now(),
  primary key (user_id, lang)
);

create table if not exists public.cl_saved_translations (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  lang        text not null check (char_length(lang) between 2 and 8),
  english     text not null check (char_length(english) <= 2000),
  translation text not null check (char_length(translation) <= 2000),
  ipa         text check (char_length(ipa) <= 2000),
  phonetic    text check (char_length(phonetic) <= 2000),
  saved_at    timestamptz not null default now(),
  unique (user_id, lang, english)
);

create table if not exists public.cl_invite_requests (
  id         bigint generated always as identity primary key,
  email      text not null check (char_length(email) between 5 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name       text check (char_length(name) <= 120),
  note       text check (char_length(note) <= 1000),
  status     text not null default 'new' check (status in ('new','invited','declined')),
  created_at timestamptz not null default now()
);
create unique index if not exists cl_invite_requests_email_key on public.cl_invite_requests (lower(email));

alter table public.cl_user_progress      enable row level security;
alter table public.cl_saved_translations enable row level security;
alter table public.cl_invite_requests    enable row level security;

drop policy if exists "own rows" on public.cl_user_progress;
create policy "own rows" on public.cl_user_progress for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own rows" on public.cl_saved_translations;
create policy "own rows" on public.cl_saved_translations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Requests: insert only, as a new request. No select, update or delete for anon/authenticated.
drop policy if exists "anyone can request" on public.cl_invite_requests;
create policy "anyone can request" on public.cl_invite_requests for insert to anon, authenticated
  with check (status = 'new');

revoke all on public.cl_user_progress, public.cl_saved_translations, public.cl_invite_requests from anon;
grant select, insert, update, delete on public.cl_user_progress, public.cl_saved_translations to authenticated;
grant insert (email, name, note) on public.cl_invite_requests to anon, authenticated;
revoke select, update, delete on public.cl_invite_requests from authenticated;

revoke truncate, references, trigger on public.cl_user_progress, public.cl_saved_translations, public.cl_invite_requests from authenticated;
