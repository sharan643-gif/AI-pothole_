-- =====================================================================
-- RoadGuard AI — 0005 self-registration role
--
-- The sign-up screen offers two segments: Public (CITIZEN) and Officer
-- (OFFICER). This migration lets that choice take effect:
--
--   * the requested role arrives in auth metadata (`raw_user_meta_data.role`)
--   * ONLY 'CITIZEN' and 'OFFICER' are honoured — ADMIN/SUPERVISOR can never
--     be self-granted and fall back to CITIZEN
--   * an OFFICER also gets an `officers` row so dispatch can reach them
--
-- Admin-granted role changes remain guarded by `guard_profile_role` in 0003.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := upper(coalesce(new.raw_user_meta_data ->> 'role', 'CITIZEN'));
  final_role     public.user_role;
begin
  final_role := case
    when requested_role = 'OFFICER' then 'OFFICER'::public.user_role
    else 'CITIZEN'::public.user_role
  end;

  insert into public.profiles (id, full_name, email, avatar_url, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url',
    final_role
  )
  on conflict (id) do nothing;

  -- Officers need a roster row so assignment/dispatch can find them.
  if final_role = 'OFFICER'::public.user_role then
    insert into public.officers (profile_id, phone, department, status)
    values (new.id, null, 'ROADS', 'AVAILABLE'::public.officer_status)
    on conflict (profile_id) do nothing;
  end if;

  return new;
end;
$$;
