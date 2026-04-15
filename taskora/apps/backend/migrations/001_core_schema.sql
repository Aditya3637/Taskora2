begin;

-- 001_core_schema.sql
-- Core entity hierarchy: auth.users → public.users → businesses → buildings/clients/members
-- businesses.type controls the entity pool: 'building' type uses buildings table, 'client' type uses clients table

-- Users (mirrors Supabase auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  avatar_url text,
  settings jsonb default '{}',
  created_at timestamptz default now()
);

-- Businesses
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 100),
  type text not null check (type in ('building', 'client')),
  owner_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Entity pools
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 100),
  address text,
  business_id uuid not null references public.businesses(id) on delete cascade,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 100),
  contact_info jsonb default '{}',
  business_id uuid not null references public.businesses(id) on delete cascade,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Business members
create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  primary key (business_id, user_id)
);

commit;
