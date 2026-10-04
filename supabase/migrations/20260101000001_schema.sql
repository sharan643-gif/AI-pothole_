-- =====================================================================
-- RoadGuard AI — 0001 schema
-- Enums, tables, indexes. RLS lives in 0002, logic in 0003.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- PostGIS is optional. We only need it for spatial aggregation conveniences;
-- all core distance maths uses the portable haversine function in 0003.
do $$
begin
  create extension if not exists postgis;
exception
  when others then
    raise notice 'PostGIS unavailable — continuing without it.';
end
$$;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type user_role as enum ('CITIZEN', 'OFFICER', 'ADMIN', 'SUPERVISOR');
create type officer_status as enum ('AVAILABLE', 'BUSY', 'OFFLINE', 'ON_SITE');
create type severity_level as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
create type risk_level as enum ('LOW', 'MEDIUM', 'HIGH');
create type road_damage_type as enum (
  'POTHOLE', 'ALLIGATOR_CRACKING', 'RUTTING', 'EDGE_BREAK', 'SINKHOLE', 'UNKNOWN'
);
create type recommended_action as enum (
  'MONITOR', 'SCHEDULE_REPAIR', 'PRIORITY_REPAIR', 'URGENT_REPAIR'
);
create type measurement_method as enum (
  'AR_DEPTH_SENSOR', 'MONOCULAR_DEPTH_ESTIMATION', 'REFERENCE_OBJECT',
  'CV_GEOMETRY', 'VISION_ESTIMATE', 'FUSED', 'MANUAL', 'UNKNOWN'
);
create type pothole_status as enum (
  'DETECTED', 'REPORTED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE',
  'ON_SITE', 'UNDER_REPAIR', 'AI_VERIFICATION', 'RESOLVED', 'REJECTED'
);
create type assignment_status as enum (
  'PENDING', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'COMPLETED', 'DECLINED', 'CANCELLED'
);
create type notification_type as enum (
  'REPORT_RECEIVED', 'OFFICER_ASSIGNED', 'OFFICER_EN_ROUTE', 'REPAIR_COMPLETED',
  'STATUS_CHANGE', 'ASSIGNMENT_OFFER', 'SYSTEM'
);

-- ---------------------------------------------------------------------
-- Incident code generator (referenced by the potholes default below)
-- ---------------------------------------------------------------------
create sequence if not exists public.pothole_incident_seq start 1000;

create or replace function public.next_incident_code()
returns text
language sql
volatile
set search_path = public
as $$
  select 'PTH-' || lpad(nextval('public.pothole_incident_seq')::text, 4, '0');
$$;

-- ---------------------------------------------------------------------
-- profiles — 1:1 with auth.users
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  email      text,
  phone      text,
  role       user_role not null default 'CITIZEN',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Application user profile, one row per auth user.';

-- ---------------------------------------------------------------------
-- officers
-- ---------------------------------------------------------------------
create table public.officers (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null unique references public.profiles (id) on delete cascade,
  department     text not null default 'ROADS',
  phone          text,
  latitude       double precision,
  longitude      double precision,
  status         officer_status not null default 'OFFLINE',
  assigned_zone  text,
  specialization text default 'POTHOLE_REPAIR',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint officers_lat_range check (latitude is null or latitude between -90 and 90),
  constraint officers_lon_range check (longitude is null or longitude between -180 and 180)
);

create index officers_status_idx on public.officers (status);
create index officers_zone_idx on public.officers (assigned_zone);

-- ---------------------------------------------------------------------
-- potholes
-- ---------------------------------------------------------------------
create table public.potholes (
  id                    uuid primary key default gen_random_uuid(),
  incident_code         text not null unique default public.next_incident_code(),
  reported_by           uuid references public.profiles (id) on delete set null,
  latitude              double precision not null check (latitude between -90 and 90),
  longitude             double precision not null check (longitude between -180 and 180),
  address               text,
  image_url             text,
  width_cm              double precision check (width_cm is null or width_cm >= 0),
  length_cm             double precision check (length_cm is null or length_cm >= 0),
  depth_cm              double precision check (depth_cm is null or depth_cm >= 0),
  area_cm2              double precision check (area_cm2 is null or area_cm2 >= 0),
  depth_method          measurement_method not null default 'UNKNOWN',
  depth_confidence      double precision check (
                          depth_confidence is null or depth_confidence between 0 and 1),
  measurement_confidence double precision check (
                          measurement_confidence is null or measurement_confidence between 0 and 1),
  ai_confidence         double precision check (
                          ai_confidence is null or ai_confidence between 0 and 1),
  severity              severity_level not null default 'MEDIUM',
  priority_score        double precision not null default 0 check (priority_score between 0 and 100),
  priority_level        severity_level not null default 'MEDIUM',
  traffic_risk          risk_level not null default 'MEDIUM',
  vehicle_risk          risk_level not null default 'MEDIUM',
  road_damage_type      road_damage_type not null default 'POTHOLE',
  recommended_action    recommended_action not null default 'SCHEDULE_REPAIR',
  status                pothole_status not null default 'DETECTED',
  zone                  text,
  road_type             text default 'LOCAL',
  near_school           boolean not null default false,
  near_hospital         boolean not null default false,
  near_intersection     boolean not null default false,
  report_count          integer not null default 1,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index potholes_status_idx on public.potholes (status);
create index potholes_severity_idx on public.potholes (severity);
create index potholes_priority_idx on public.potholes (priority_score desc);
create index potholes_created_idx on public.potholes (created_at desc);
create index potholes_reporter_idx on public.potholes (reported_by);
create index potholes_geo_idx on public.potholes (latitude, longitude);

-- ---------------------------------------------------------------------
-- pothole_analysis — immutable AI audit trail
-- ---------------------------------------------------------------------
create table public.pothole_analysis (
  id                  uuid primary key default gen_random_uuid(),
  pothole_id          uuid not null references public.potholes (id) on delete cascade,
  model               text not null,
  prompt_version      text not null default 'v1',
  raw_response        jsonb,
  structured_response jsonb,
  confidence          double precision check (confidence is null or confidence between 0 and 1),
  depth_method        measurement_method not null default 'UNKNOWN',
  depth_confidence    double precision check (
                        depth_confidence is null or depth_confidence between 0 and 1),
  created_at          timestamptz not null default now()
);

create index pothole_analysis_pothole_idx on public.pothole_analysis (pothole_id);
comment on table public.pothole_analysis is
  'Append-only record of every AI analysis, including rejected/malformed responses.';

-- ---------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------
create table public.assignments (
  id                       uuid primary key default gen_random_uuid(),
  pothole_id               uuid not null references public.potholes (id) on delete cascade,
  officer_id               uuid not null references public.officers (id) on delete cascade,
  assigned_at              timestamptz not null default now(),
  accepted_at              timestamptz,
  arrived_at               timestamptz,
  completed_at             timestamptz,
  status                   assignment_status not null default 'PENDING',
  distance_km              double precision check (distance_km is null or distance_km >= 0),
  estimated_arrival_minutes integer check (
                             estimated_arrival_minutes is null or estimated_arrival_minutes >= 0),
  assignment_score         double precision,
  assigned_by              uuid references public.profiles (id) on delete set null,
  decline_reason           text
);

create index assignments_officer_idx on public.assignments (officer_id);
create index assignments_pothole_idx on public.assignments (pothole_id);
create index assignments_status_idx on public.assignments (status);
-- Only one live assignment per pothole.
create unique index assignments_one_active_idx
  on public.assignments (pothole_id)
  where status in ('PENDING', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE');

-- ---------------------------------------------------------------------
-- repair_records
-- ---------------------------------------------------------------------
create table public.repair_records (
  id                     uuid primary key default gen_random_uuid(),
  pothole_id             uuid not null references public.potholes (id) on delete cascade,
  officer_id             uuid not null references public.officers (id) on delete cascade,
  before_image_url       text,
  after_image_url        text,
  repair_notes           text,
  repair_type            text,
  material               text,
  ai_verification        jsonb,
  verification_confidence double precision check (
                           verification_confidence is null or verification_confidence between 0 and 1),
  approved               boolean,
  completed_at           timestamptz,
  created_at             timestamptz not null default now()
);

create index repair_records_pothole_idx on public.repair_records (pothole_id);

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  pothole_id uuid references public.potholes (id) on delete cascade,
  title      text not null,
  message    text not null,
  type       notification_type not null default 'SYSTEM',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- severity_config — weights are DATA, not hard-coded constants (spec 6)
-- ---------------------------------------------------------------------
create table public.severity_config (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  weight     double precision not null check (weight >= 0),
  thresholds jsonb not null default '{}'::jsonb,
  notes      text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- scan_queue — optional server-side audit of raw scans (offline sync)
-- ---------------------------------------------------------------------
create table public.scan_queue (
  id           uuid primary key default gen_random_uuid(),
  client_id    text not null,
  payload      jsonb not null,
  device_info  jsonb,
  uploaded_at  timestamptz not null default now(),
  processed    boolean not null default false
);

create index scan_queue_client_idx on public.scan_queue (client_id);
