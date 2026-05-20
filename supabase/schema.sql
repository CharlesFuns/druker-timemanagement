create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('work', 'growth', 'family', 'health', 'other')),
  description text,
  color text not null default '#00B7BD',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  goal_id uuid references public.goals(id) on delete set null,
  category text not null default 'other' check (category in ('work', 'growth', 'family', 'health', 'other')),
  due_time timestamptz,
  estimated_minutes integer,
  priority text default 'medium' check (priority in ('high', 'medium', 'low')),
  status text not null default 'not_started' check (status in ('not_started', 'running', 'paused', 'completed')),
  total_duration_seconds integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  goal_id uuid references public.goals(id) on delete set null,
  category text not null default 'other' check (category in ('work', 'growth', 'family', 'health', 'other')),
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_repeat boolean not null default false,
  repeat_rule jsonb,
  reminder_rule jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedules_time_order check (end_time > start_time)
);

create table if not exists public.time_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('task', 'schedule', 'manual')),
  source_id uuid,
  goal_id uuid references public.goals(id) on delete set null,
  category text not null default 'other' check (category in ('work', 'growth', 'family', 'health', 'other')),
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz,
  duration_seconds integer not null default 0,
  is_running boolean not null default false,
  is_manual boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_segments_time_order check (end_time is null or end_time > start_time),
  constraint running_segments_have_no_end check ((is_running = true and end_time is null) or (is_running = false))
);

create table if not exists public.review_journals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  review_date date not null,
  emotional_event text,
  emotion_feeling text,
  thought_at_that_time text,
  words_and_actions text,
  awareness text,
  message_to_self text,
  next_time_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, review_date)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  review_type text not null check (review_type in ('day', 'week', 'month')),
  period_start date not null,
  period_end date not null,
  date_range jsonb,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, review_type, period_start, period_end)
);

create index if not exists goals_user_id_idx on public.goals(user_id);
create index if not exists tasks_user_id_status_idx on public.tasks(user_id, status);
create index if not exists tasks_user_id_due_time_idx on public.tasks(user_id, due_time);
create index if not exists schedules_user_id_start_time_idx on public.schedules(user_id, start_time);
create index if not exists time_segments_user_id_start_time_idx on public.time_segments(user_id, start_time);
create index if not exists time_segments_user_id_source_idx on public.time_segments(user_id, source_type, source_id);
create index if not exists review_journals_user_date_idx on public.review_journals(user_id, review_date);

drop trigger if exists set_goals_updated_at on public.goals;
create trigger set_goals_updated_at
before update on public.goals
for each row execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_schedules_updated_at on public.schedules;
create trigger set_schedules_updated_at
before update on public.schedules
for each row execute function public.set_updated_at();

drop trigger if exists set_time_segments_updated_at on public.time_segments;
create trigger set_time_segments_updated_at
before update on public.time_segments
for each row execute function public.set_updated_at();

drop trigger if exists set_review_journals_updated_at on public.review_journals;
create trigger set_review_journals_updated_at
before update on public.review_journals
for each row execute function public.set_updated_at();

drop trigger if exists set_reviews_updated_at on public.reviews;
create trigger set_reviews_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

alter table public.goals enable row level security;
alter table public.tasks enable row level security;
alter table public.schedules enable row level security;
alter table public.time_segments enable row level security;
alter table public.review_journals enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "Users can read own goals" on public.goals;
drop policy if exists "Users can insert own goals" on public.goals;
drop policy if exists "Users can update own goals" on public.goals;
drop policy if exists "Users can delete own goals" on public.goals;
create policy "Users can read own goals" on public.goals for select using (auth.uid() = user_id);
create policy "Users can insert own goals" on public.goals for insert with check (auth.uid() = user_id);
create policy "Users can update own goals" on public.goals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own goals" on public.goals for delete using (auth.uid() = user_id);

drop policy if exists "Users can read own tasks" on public.tasks;
drop policy if exists "Users can insert own tasks" on public.tasks;
drop policy if exists "Users can update own tasks" on public.tasks;
drop policy if exists "Users can delete own tasks" on public.tasks;
create policy "Users can read own tasks" on public.tasks for select using (auth.uid() = user_id);
create policy "Users can insert own tasks" on public.tasks for insert with check (auth.uid() = user_id);
create policy "Users can update own tasks" on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own tasks" on public.tasks for delete using (auth.uid() = user_id);

drop policy if exists "Users can read own schedules" on public.schedules;
drop policy if exists "Users can insert own schedules" on public.schedules;
drop policy if exists "Users can update own schedules" on public.schedules;
drop policy if exists "Users can delete own schedules" on public.schedules;
create policy "Users can read own schedules" on public.schedules for select using (auth.uid() = user_id);
create policy "Users can insert own schedules" on public.schedules for insert with check (auth.uid() = user_id);
create policy "Users can update own schedules" on public.schedules for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own schedules" on public.schedules for delete using (auth.uid() = user_id);

drop policy if exists "Users can read own time segments" on public.time_segments;
drop policy if exists "Users can insert own time segments" on public.time_segments;
drop policy if exists "Users can update own time segments" on public.time_segments;
drop policy if exists "Users can delete own time segments" on public.time_segments;
create policy "Users can read own time segments" on public.time_segments for select using (auth.uid() = user_id);
create policy "Users can insert own time segments" on public.time_segments for insert with check (auth.uid() = user_id);
create policy "Users can update own time segments" on public.time_segments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own time segments" on public.time_segments for delete using (auth.uid() = user_id);

drop policy if exists "Users can read own journals" on public.review_journals;
drop policy if exists "Users can insert own journals" on public.review_journals;
drop policy if exists "Users can update own journals" on public.review_journals;
drop policy if exists "Users can delete own journals" on public.review_journals;
create policy "Users can read own journals" on public.review_journals for select using (auth.uid() = user_id);
create policy "Users can insert own journals" on public.review_journals for insert with check (auth.uid() = user_id);
create policy "Users can update own journals" on public.review_journals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own journals" on public.review_journals for delete using (auth.uid() = user_id);

drop policy if exists "Users can read own reviews" on public.reviews;
drop policy if exists "Users can insert own reviews" on public.reviews;
drop policy if exists "Users can update own reviews" on public.reviews;
drop policy if exists "Users can delete own reviews" on public.reviews;
create policy "Users can read own reviews" on public.reviews for select using (auth.uid() = user_id);
create policy "Users can insert own reviews" on public.reviews for insert with check (auth.uid() = user_id);
create policy "Users can update own reviews" on public.reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own reviews" on public.reviews for delete using (auth.uid() = user_id);
