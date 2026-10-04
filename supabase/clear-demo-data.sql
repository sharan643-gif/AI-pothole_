-- =====================================================================
-- RoadGuard AI — remove all demo data
--
-- Run this once against your Supabase project (SQL Editor, or
-- `psql "$DATABASE_URL" -f supabase/clear-demo-data.sql`) to scrub the
-- sample incidents inserted by the old 0004 seed migration.
--
-- Safe to run more than once.
-- =====================================================================

-- 1. Seeded sample incidents are tagged in `notes`.
delete from public.potholes where notes = 'DEMO_SEED';

-- 2. Belt and braces: the old seed used a fixed set of incident codes.
delete from public.potholes
where incident_code in (
  'PTH-1042', 'PTH-1043', 'PTH-1044', 'PTH-1045', 'PTH-1046',
  'PTH-1047', 'PTH-1048', 'PTH-1049', 'PTH-1050'
);

-- 3. Verify the table is empty of demo rows (should return 0).
select count(*) as remaining_demo_rows
from public.potholes
where notes = 'DEMO_SEED';

-- 4. OPTIONAL — remove throwaway diagnostic accounts created during setup.
--    Deleting the auth user cascades to profiles, officers and their data.
--    Adjust the pattern to match whatever test addresses you used.
--
-- delete from auth.users where email like 'rg.%@example.com';
