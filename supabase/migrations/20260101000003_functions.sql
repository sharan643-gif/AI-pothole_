-- =====================================================================
-- RoadGuard AI — 0003 functions, triggers, storage & seed
-- =====================================================================

-- ---------------------------------------------------------------------
-- Portable haversine distance (km). Works with or without PostGIS.
-- ---------------------------------------------------------------------
create or replace function public.haversine_km(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
    * power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch   before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger officers_touch   before update on public.officers
  for each row execute function public.touch_updated_at();
create trigger potholes_touch   before update on public.potholes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- New auth user → profile
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Role escalation guard: only admins may change a role, and flipping a
-- profile to OFFICER provisions an officers row automatically.
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    new.role := old.role;
  end if;

  if new.role in ('OFFICER', 'SUPERVISOR')
     and (old.role is distinct from new.role)
     and not exists (select 1 from public.officers where profile_id = new.id) then
    insert into public.officers (profile_id, phone, department)
    values (new.id, new.phone, 'ROADS');
  end if;

  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------
-- Duplicate-aware pothole intake: count nearby pre-existing reports so the
-- recurrence term in the severity engine has real data to work with.
-- ---------------------------------------------------------------------
create or replace function public.pothole_intake()
returns trigger
language plpgsql
as $$
declare
  nearby integer;
begin
  select count(*) into nearby
  from public.potholes p
  where p.id <> new.id
    and public.haversine_km(new.latitude, new.longitude, p.latitude, p.longitude) < 0.025;

  if nearby > 0 then
    new.report_count := nearby + 1;
  end if;

  if new.zone is null then
    new.zone := 'ZONE-' || lpad(
      (abs(floor(new.latitude * 10))::int % 12 + 1)::text, 2, '0'
    );
  end if;

  if new.area_cm2 is null and new.width_cm is not null and new.length_cm is not null then
    new.area_cm2 := new.width_cm * new.length_cm;
  end if;

  return new;
end;
$$;

create trigger potholes_intake
  before insert on public.potholes
  for each row execute function public.pothole_intake();

-- ---------------------------------------------------------------------
-- Notification fan-out (realtime-friendly, bypasses RLS by design)
-- ---------------------------------------------------------------------
create or replace function public.notify_report_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reported_by is not null then
    insert into public.notifications (user_id, pothole_id, title, message, type)
    values (
      new.reported_by,
      new.id,
      'Report received',
      new.incident_code || ' — priority ' || new.priority_level::text || '.',
      'REPORT_RECEIVED'
    );
  end if;
  return new;
end;
$$;

create trigger potholes_notify_created
  after insert on public.potholes
  for each row execute function public.notify_report_created();

create or replace function public.notify_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  title text;
  kind  notification_type := 'STATUS_CHANGE';
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  case new.status
    when 'ASSIGNED' then title := 'An officer has been assigned.';
    when 'ACCEPTED' then title := 'Your report was accepted.';
    when 'EN_ROUTE'  then title := 'Officer is on the way.';
    when 'ON_SITE'   then title := 'Officer has arrived on site.';
    when 'UNDER_REPAIR' then title := 'Repair work has started.';
    when 'AI_VERIFICATION' then title := 'Repair submitted for AI verification.';
    when 'RESOLVED'  then title := 'Issue resolved ✓'; kind := 'REPAIR_COMPLETED';
    when 'REJECTED'  then title := 'Report closed as invalid.';
    else title := 'Status updated to ' || new.status::text || '.';
  end case;

  if new.reported_by is not null then
    insert into public.notifications (user_id, pothole_id, title, message, type)
    values (
      new.reported_by,
      new.id,
      title,
      new.incident_code || ' — ' || replace(new.status::text, '_', ' ') || '.',
      kind
    );
  end if;

  return new;
end;
$$;

create trigger potholes_notify_status
  after update on public.potholes
  for each row execute function public.notify_status_change();

create or replace function public.notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  officer_profile uuid;
  p public.potholes%rowtype;
begin
  select profile_id into officer_profile from public.officers where id = new.officer_id;
  select * into p from public.potholes where id = new.pothole_id;

  if officer_profile is not null then
    insert into public.notifications (user_id, pothole_id, title, message, type)
    values (
      officer_profile,
      new.pothole_id,
      'New ' || lower(p.priority_level::text) || ' pothole assigned',
      p.incident_code || ' — ' || coalesce(round(new.distance_km::numeric, 1)::text, '?') || ' km away.',
      'ASSIGNMENT_OFFER'
    );
  end if;

  if p.reported_by is not null then
    insert into public.notifications (user_id, pothole_id, title, message, type)
    values (
      p.reported_by,
      new.pothole_id,
      'An officer has been assigned.',
      p.incident_code || ' — maintenance team dispatched.',
      'OFFICER_ASSIGNED'
    );
  end if;

  return new;
end;
$$;

create trigger assignments_notify
  after insert on public.assignments
  for each row execute function public.notify_assignment();

-- ---------------------------------------------------------------------
-- Nearest-officer query with a transparent, additive scoring model
-- (spec section 11). Returns the ranked shortlist; selection happens in
-- the assign-officer edge function so it can be logged and audited.
-- ---------------------------------------------------------------------
create or replace function public.find_nearest_officers(
  p_latitude  double precision,
  p_longitude double precision,
  p_department text default 'ROADS',
  p_zone text default null,
  p_limit integer default 5
)
returns table (
  officer_id uuid,
  profile_id uuid,
  full_name text,
  status officer_status,
  assigned_zone text,
  specialization text,
  distance_km double precision,
  eta_minutes integer,
  assignment_score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select
      o.id,
      o.profile_id,
      coalesce(pr.full_name, 'Unnamed officer') as full_name,
      o.status,
      o.assigned_zone,
      o.specialization,
      case
        when o.latitude is null or o.longitude is null then null
        else public.haversine_km(p_latitude, p_longitude, o.latitude, o.longitude)
      end as distance_km
    from public.officers o
    left join public.profiles pr on pr.id = o.profile_id
    where o.status = 'AVAILABLE'
      and (p_department is null or o.department = p_department)
  ),
  scored as (
    select
      c.*,
      (100 - least(100, coalesce(c.distance_km, 50) * 12)) as distance_score,
      case c.status
        when 'AVAILABLE' then 100
        when 'ON_SITE' then 40
        else 20
      end as availability_score,
      case
        when p_zone is null or c.assigned_zone is null then 50
        when c.assigned_zone = p_zone then 100
        else 30
      end as zone_score,
      case
        when c.specialization ilike '%pothole%' or c.specialization ilike '%road%' then 100
        else 55
      end as specialization_score
    from candidates c
  )
  select
    s.id,
    s.profile_id,
    s.full_name,
    s.status,
    s.assigned_zone,
    s.specialization,
    s.distance_km,
    case
      when s.distance_km is null then null
      else greatest(1, round((s.distance_km / 28.0) * 60))::int
    end as eta_minutes,
    round(
      (s.distance_score * 0.45
       + s.availability_score * 0.25
       + s.zone_score * 0.15
       + s.specialization_score * 0.15)::numeric, 2
    )::double precision as assignment_score
  from scored s
  order by assignment_score desc, s.distance_km asc nulls last
  limit greatest(1, p_limit);
$$;

-- ---------------------------------------------------------------------
-- Admin analytics (spec 28 / 52) — all figures come from real rows.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select
      count(*) as total,
      count(*) filter (where severity = 'CRITICAL' and status <> 'RESOLVED') as critical,
      count(*) filter (where status in ('ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'UNDER_REPAIR')) as in_repair,
      count(*) filter (where status = 'RESOLVED') as resolved,
      count(*) filter (where status = 'RESOLVED' and updated_at::date = current_date) as resolved_today,
      avg(extract(epoch from (updated_at - created_at)) / 3600.0)
        filter (where status = 'RESOLVED') as avg_resolution_hours
    from public.potholes
  )
  select jsonb_build_object(
    'total', agg.total,
    'critical', agg.critical,
    'inRepair', agg.in_repair,
    'resolved', agg.resolved,
    'resolvedToday', agg.resolved_today,
    'avgResolutionHours', round(coalesce(agg.avg_resolution_hours, 0)::numeric, 1)
  )
  from agg;
$$;

-- ---------------------------------------------------------------------
-- Aggregate grid for the density heatmap (spec 53)
-- ---------------------------------------------------------------------
create or replace function public.pothole_heatmap(p_cell_deg double precision default 0.01)
returns table (
  cell_lat double precision,
  cell_lon double precision,
  bucket integer,
  total integer,
  critical integer,
  avg_priority double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    round((latitude / p_cell_deg)) * p_cell_deg as cell_lat,
    round((longitude / p_cell_deg)) * p_cell_deg as cell_lon,
    least(5, greatest(1, ceil(count(*) / 2.0)))::int as bucket,
    count(*)::int as total,
    count(*) filter (where severity = 'CRITICAL')::int as critical,
    round(avg(priority_score)::numeric, 1)::double precision as avg_priority
  from public.potholes
  group by 1, 2
  having count(*) > 0;
$$;

-- ---------------------------------------------------------------------
-- Storage buckets (spec 21) — private; the app serves signed URLs.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('pothole-images', 'pothole-images', false, 15728640,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('repair-images', 'repair-images', false, 15728640,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('avatars', 'avatars', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('reports', 'reports', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

-- Objects are namespaced as <bucket>/<auth.uid()>/<file>. Policies enforce
-- that namespace so one user can never read or overwrite another's uploads.
create policy "owners upload to their namespace"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('pothole-images', 'repair-images', 'avatars', 'reports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owners read their namespace"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('pothole-images', 'repair-images', 'avatars', 'reports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "officers and admins read civic imagery"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('pothole-images', 'repair-images')
    and public.is_officer()
  );

create policy "owners update their namespace"
  on storage.objects for update to authenticated
  using ((storage.foldername(name))[1] = auth.uid()::text)
  with check ((storage.foldername(name))[1] = auth.uid()::text);

create policy "owners delete their namespace"
  on storage.objects for delete to authenticated
  using ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin());

-- ---------------------------------------------------------------------
-- Seed the severity engine config (spec 6: weights live in the DB)
-- ---------------------------------------------------------------------
insert into public.severity_config (key, weight, thresholds, notes) values
  ('depth',         0.30, '{"maxCm": 25}',        'Contribution of measured/estimated depth.'),
  ('area',          0.20, '{"maxCm2": 20000}',    'Contribution of surface area.'),
  ('traffic',       0.20, '{"low":34,"medium":67,"high":100}', 'Traffic exposure.'),
  ('location_risk', 0.15, '{"schoolBonus":18,"hospitalBonus":16,"intersectionBonus":10}',
                                                      'Road class + sensitive receptors.'),
  ('confidence',    0.15, '{}',                   'Certainty of the estimate.'),
  ('recurrence',    0.05, '{"maxReports": 5}',    'Repeat reports at the same location.'),
  ('thresholds',    1.00, '{"critical":80,"high":60,"medium":40}', 'Score cut points.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Realtime (spec 23)
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.potholes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.assignments;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

alter table public.potholes replica identity full;
alter table public.assignments replica identity full;
alter table public.notifications replica identity full;
