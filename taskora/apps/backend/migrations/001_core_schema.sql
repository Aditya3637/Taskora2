-- 001_core_schema.sql

create extension if not exists "uuid-ossp";

-- Users (mirrors Supabase auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  phone text,
  avatar_url text,
  settings jsonb default '{}',
  created_at timestamptz default now()
);

-- Businesses
create table public.businesses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type text not null check (type in ('building', 'client')),
  owner_id uuid not null references public.users(id),
  created_at timestamptz default now()
);

-- Entity pools
create table public.buildings (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  business_id uuid not null references public.businesses(id) on delete cascade,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table public.clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  contact_info jsonb default '{}',
  business_id uuid not null references public.businesses(id) on delete cascade,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Business members
create table public.business_members (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  unique(business_id, user_id)
);
