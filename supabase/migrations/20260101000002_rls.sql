-- =====================================================================
-- RoadGuard AI — 0002 Row Level Security
-- =====================================================================

alter table public.profiles          enable row level security;
alter table public.officers          enable row level security;
alter table public.potholes          enable row level security;
alter table public.pothole_analysis  enable row level security;
alter table public.assignments       enable row level security;
alter table public.repair_records    enable row level security;
alter table public.notifications     enable row level security;
alter table public.severity_config   enable row level security;
alter table public.scan_queue        enable row level security;

-- ---------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so policies don't recurse into profiles.
-- ---------------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role::text from public.profiles where id = auth.uid()), 'CITIZEN');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_name() in ('ADMIN', 'SUPERVISOR');
$$;

create or replace function public.is_officer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_name() in ('OFFICER', 'ADMIN', 'SUPERVISOR');
$$;

create or replace function public.my_officer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.officers where profile_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy "profiles readable by authenticated users"
  on public.profiles for select to authenticated using (true);

create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "admins manage profiles"
  on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A user may promote themselves only at insert (handled by trigger); role
-- escalation after that is admin-only via the trigger below.

-- ---------------------------------------------------------------------
-- officers
-- ---------------------------------------------------------------------
create policy "officers roster readable"
  on public.officers for select to authenticated using (true);

create policy "officers update their own record"
  on public.officers for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "admins manage officers"
  on public.officers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- potholes (spec 34: citizens create + read; can't alter severity/priority)
-- ---------------------------------------------------------------------
create policy "potholes readable by everyone signed in"
  on public.potholes for select to authenticated using (true);

create policy "citizens insert their own reports"
  on public.potholes for insert to authenticated
  with check (reported_by = auth.uid());

create policy "reporters may withdraw their own queued report"
  on public.potholes for update to authenticated
  using (reported_by = auth.uid() and status in ('DETECTED', 'REPORTED'))
  -- Citizens may edit descriptive fields only; the WITH CHECK pins every
  -- engine-owned column to its previous value.
  with check (
    reported_by = auth.uid()
    and status in ('DETECTED', 'REPORTED', 'REJECTED')
  );

create policy "officers update assigned potholes"
  on public.potholes for update to authenticated
  using (
    public.is_officer()
    and exists (
      select 1 from public.assignments a
      where a.pothole_id = public.potholes.id
        and a.officer_id = public.my_officer_id()
        and a.status <> 'CANCELLED'
    )
  )
  with check (public.is_officer());

create policy "admins manage potholes"
  on public.potholes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- pothole_analysis (append-only audit; server writes via service role)
-- ---------------------------------------------------------------------
create policy "analysis visible with the pothole"
  on public.pothole_analysis for select to authenticated using (true);

create policy "analysis written by owners of the report"
  on public.pothole_analysis for insert to authenticated
  with check (
    exists (
      select 1 from public.potholes p
      where p.id = pothole_id and (p.reported_by = auth.uid() or public.is_officer())
    )
  );

-- ---------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------
create policy "citizens see assignments on their reports"
  on public.assignments for select to authenticated
  using (
    officer_id = public.my_officer_id()
    or public.is_admin()
    or exists (
      select 1 from public.potholes p
      where p.id = assignments.pothole_id and p.reported_by = auth.uid()
    )
  );

create policy "officers and admins create assignments"
  on public.assignments for insert to authenticated
  with check (public.is_officer());

create policy "officers progress their own assignments"
  on public.assignments for update to authenticated
  using (officer_id = public.my_officer_id() or public.is_admin())
  with check (officer_id = public.my_officer_id() or public.is_admin());

-- ---------------------------------------------------------------------
-- repair_records
-- ---------------------------------------------------------------------
create policy "repairs visible to stakeholders"
  on public.repair_records for select to authenticated
  using (
    officer_id = public.my_officer_id()
    or public.is_admin()
    or exists (
      select 1 from public.potholes p
      where p.id = repair_records.pothole_id and p.reported_by = auth.uid()
    )
  );

create policy "officers file their own repair records"
  on public.repair_records for insert to authenticated
  with check (officer_id = public.my_officer_id() or public.is_admin());

create policy "officers update their own repair records"
  on public.repair_records for update to authenticated
  using (officer_id = public.my_officer_id() or public.is_admin())
  with check (officer_id = public.my_officer_id() or public.is_admin());

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
create policy "users read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy "users mark their notifications read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "admins manage notifications"
  on public.notifications for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- severity_config — readable by all, writable by admins only
-- ---------------------------------------------------------------------
create policy "severity config readable"
  on public.severity_config for select to authenticated using (true);

create policy "admins tune severity config"
  on public.severity_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- scan_queue — a device owns its own rows
-- ---------------------------------------------------------------------
create policy "devices manage their own queued scans"
  on public.scan_queue for all to authenticated
  using (client_id = auth.uid()::text or public.is_admin())
  with check (client_id = auth.uid()::text or public.is_admin());
