begin;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists rt_private;
revoke all on schema rt_private from public, anon, authenticated;
-- Bootstrap missing legacy tables on new installations; preserve existing installations.
create table if not exists public.subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 product text not null, status text not null default 'inactive', access_source text,
 expires_at timestamptz, current_period_end timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), unique(user_id,product)
);
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists expires_at timestamptz;
create table if not exists public.profiles(id uuid primary key references auth.users(id),email text,full_name text,admin_notes text,created_at timestamptz default now(),updated_at timestamptz default now());
create table if not exists public.support_messages(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),subject text,message text,status text default 'open',created_at timestamptz default now());
create table if not exists public.shift_planner_schedules(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),name text,week_label text,schedule_data jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
create table if not exists public.shift_planner_settings(user_id uuid primary key references auth.users(id),target_labor_percent numeric default 35,caution_labor_percent numeric default 28,danger_labor_percent numeric default 35,overtime_threshold numeric default 40,minimum_staff_per_shift int default 2,business_type text,opening_time text,closing_time text,max_consecutive_days int default 6,preferred_strategy text,busy_days jsonb,weekly_budget numeric,updated_at timestamptz default now());

create table public.rt_businesses (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id), name text not null check(length(name) between 2 and 100),
 timezone text not null default 'America/New_York', week_start int not null default 1 check(week_start between 0 and 6),
 overtime_hours numeric not null default 40 check(overtime_hours>0 and overtime_hours<=168), overtime_multiplier numeric not null default 1.5 check(overtime_multiplier>=1 and overtime_multiplier<=5),
 paid_breaks boolean not null default false, weekly_budget numeric check(weekly_budget>=0), target_labor_percent numeric not null default 35 check(target_labor_percent>0 and target_labor_percent<=100),
 minimum_staff int not null default 2 check(minimum_staff between 1 and 100), opening_time time not null default '08:00', closing_time time not null default '17:00',
 created_at timestamptz not null default now()
);
create table public.rt_memberships(business_id uuid references public.rt_businesses(id),user_id uuid references auth.users(id),role text not null check(role in ('owner','manager')), primary key(business_id,user_id));
create table public.rt_locations(id uuid primary key default gen_random_uuid(),business_id uuid not null unique references public.rt_businesses(id),name text not null default 'Main location',tag text not null unique default encode(extensions.gen_random_bytes(24),'hex'),geofence boolean not null default false,latitude double precision check(latitude between -90 and 90),longitude double precision check(longitude between -180 and 180),radius_m numeric not null default 110 check(radius_m between 20 and 5000),accuracy_m numeric not null default 60 check(accuracy_m between 1 and 500),check(not geofence or (latitude is not null and longitude is not null)));
create table public.rt_employees(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),name text not null check(length(name) between 2 and 100),role text not null default '',active boolean not null default true,max_hours numeric not null default 40 check(max_hours>0 and max_hours<=168),unavailable_days int[] not null default '{}',legacy_id text,unique(business_id,legacy_id));
create table public.rt_rates(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),employee_id uuid not null references public.rt_employees(id),effective_at timestamptz not null,rate numeric(12,2) not null check(rate>0),unique(employee_id,effective_at));
create table public.rt_schedules(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),name text not null,week_start date not null,status text not null default 'draft' check(status in ('draft','published')),revenue numeric not null default 0 check(revenue>=0),legacy_id uuid unique,created_at timestamptz default now());
create unique index rt_one_published on public.rt_schedules(business_id,week_start) where status='published';
create table public.rt_shifts(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),schedule_id uuid not null references public.rt_schedules(id) on delete cascade,employee_id uuid not null references public.rt_employees(id),starts_at timestamptz not null,ends_at timestamptz not null,check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours'));
create table rt_private.enrollments(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),employee_id uuid not null references public.rt_employees(id),code_hash text not null,expires_at timestamptz not null,used_at timestamptz);
create table rt_private.sessions(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),employee_id uuid not null references public.rt_employees(id),token_hash text unique not null,expires_at timestamptz not null,revoked boolean not null default false);
create table rt_private.attempts(key text primary key,window_at timestamptz not null default now(),attempts int not null default 1);
create table public.rt_events(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),employee_id uuid not null references public.rt_employees(id),location_id uuid not null references public.rt_locations(id),event_type text not null check(event_type in ('clock_in','break_start','break_end','clock_out')),occurred_at timestamptz not null default now(),paid_break boolean not null default false,session_id uuid references rt_private.sessions(id),request_id uuid unique,source text not null default 'nfc',location_verified boolean not null default false,created_at timestamptz not null default now());
create index rt_event_employee_time on public.rt_events(employee_id,occurred_at);
create table public.rt_corrections(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),event_id uuid not null references public.rt_events(id),event_type text not null,occurred_at timestamptz not null,void boolean not null default false,reason text not null check(length(reason)>=3),actor_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create table public.rt_approvals(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.rt_businesses(id),employee_id uuid not null references public.rt_employees(id),week_start date not null,actor_id uuid not null references auth.users(id),approved_at timestamptz not null default now(),unique(employee_id,week_start));

create function rt_private.member(b uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from rt_memberships where business_id=b and user_id=auth.uid())$$;
create function rt_private.entitled(b uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from rt_businesses x join subscriptions s on s.user_id=x.owner_id where x.id=b and s.product='shift_planner' and s.status in ('active','paid','trialing') and (s.expires_at is null or s.expires_at>now()) and (s.current_period_end is null or s.current_period_end>now()))$$;
create function rt_private.effective_events(b uuid) returns table(id uuid,employee_id uuid,event_type text,occurred_at timestamptz,paid_break boolean,source text,corrected boolean) language sql stable security definer set search_path=public,pg_temp as $$
 select e.id,e.employee_id,coalesce(c.event_type,e.event_type),coalesce(c.occurred_at,e.occurred_at),e.paid_break,e.source,c.id is not null from rt_events e left join lateral (select * from rt_corrections where event_id=e.id order by created_at desc,id desc limit 1)c on true where e.business_id=b and not coalesce(c.void,false)
$$;
create function rt_private.validate_timeline(b uuid,emp uuid) returns void language plpgsql set search_path=public,pg_temp as $$
declare e record; state text:='off'; previous_at timestamptz;
begin
 for e in select * from rt_private.effective_events(b) where employee_id=emp order by occurred_at,id loop
  if previous_at is not null and e.occurred_at<=previous_at then raise exception 'Clock events must have distinct chronological times'; end if;
  if (state='off' and e.event_type<>'clock_in') or (state='working' and e.event_type not in ('break_start','clock_out')) or (state='break' and e.event_type not in ('break_end','clock_out')) then raise exception 'Invalid clock sequence; correct the missing or conflicting event first'; end if;
  state:=case e.event_type when 'clock_in' then 'working' when 'break_end' then 'working' when 'break_start' then 'break' else 'off' end;previous_at:=e.occurred_at;
 end loop;
end $$;
-- Only server functions mutate workforce data. All raw credential tables are private.
do $$declare t text;begin
 foreach t in array array['rt_businesses','rt_memberships','rt_locations','rt_employees','rt_rates','rt_schedules','rt_shifts','rt_events','rt_corrections','rt_approvals'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end$$;
-- Existing portal baseline policies; workforce functions never trust UI-only access checks.
do $$declare t text;begin
 foreach t in array array['subscriptions','profiles','support_messages','shift_planner_schedules','shift_planner_settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('drop policy if exists rt_legacy_read on public.%I',t);
 execute format('create policy rt_legacy_read on public.%I for select to authenticated using (%I=auth.uid())',t,case when t='profiles' then 'id' else 'user_id' end);
 execute format('drop policy if exists rt_platform_admin on public.%I',t);
 execute format('create policy rt_platform_admin on public.%I for all to authenticated using (lower(auth.jwt()->>''email'')=''farajsoftwaresolutions@gmail.com'') with check(lower(auth.jwt()->>''email'')=''farajsoftwaresolutions@gmail.com'')',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 end loop;
end$$;
insert into public.profiles(id,email) select id,email from auth.users on conflict(id) do nothing;
create function rt_private.profile_created() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin insert into profiles(id,email) values(new.id,new.email) on conflict(id) do nothing;return new;end$$;
create trigger rt_profile_created after insert on auth.users for each row execute function rt_private.profile_created();

create function public.rt_bootstrap() returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('businesses',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('entitled',rt_private.entitled(b.id),'member_role',m.role)) from rt_businesses b join rt_memberships m on m.business_id=b.id where m.user_id=auth.uid()),'[]'::jsonb),'can_create',exists(select 1 from subscriptions where user_id=auth.uid() and product='shift_planner' and status in ('active','paid','trialing') and (expires_at is null or expires_at>now()) and(current_period_end is null or current_period_end>now())))
$$;
create function public.rt_dashboard(b uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not rt_private.member(b) then raise exception 'Business access denied';end if;
 return jsonb_build_object(
 'business',(select to_jsonb(x)||jsonb_build_object('entitled',rt_private.entitled(b)) from rt_businesses x where id=b),
 'location',(select to_jsonb(x) from rt_locations x where business_id=b),
 'employees',coalesce((select jsonb_agg(x) from rt_employees x where business_id=b),'[]'::jsonb),
 'rates',coalesce((select jsonb_agg(x) from rt_rates x where business_id=b),'[]'::jsonb),
 'schedules',coalesce((select jsonb_agg(x order by week_start desc,created_at desc) from rt_schedules x where business_id=b),'[]'::jsonb),
 'shifts',coalesce((select jsonb_agg(x) from rt_shifts x where business_id=b),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(x order by occurred_at) from rt_private.effective_events(b) x),'[]'::jsonb),
 'corrections',coalesce((select jsonb_agg(x order by created_at desc) from rt_corrections x where business_id=b),'[]'::jsonb),
 'approvals',coalesce((select jsonb_agg(x) from rt_approvals x where business_id=b),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'email',u.email)) from rt_memberships m join auth.users u on u.id=m.user_id where business_id=b),'[]'::jsonb),
 'legacy',coalesce((select jsonb_agg(x) from shift_planner_schedules x where user_id=auth.uid()),'[]'::jsonb));
end $$;

create function public.rt_manage(b uuid,action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare x rt_businesses; emp uuid; sid uuid; eid uuid; code text; v_start timestamptz;v_end timestamptz;wk date;v uuid;last_type text;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if action='create_business' then
  if not exists(select 1 from subscriptions where user_id=auth.uid() and product='shift_planner' and status in ('active','trialing','paid') and (expires_at is null or expires_at>now()) and(current_period_end is null or current_period_end>now())) then raise exception 'Ask Reimage Tech to grant Shift Planner pilot access';end if;
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Choose a valid timezone';end if;
  insert into rt_businesses(owner_id,name,timezone) values(auth.uid(),trim(p->>'name'),p->>'timezone') returning id into b;
  insert into rt_memberships values(b,auth.uid(),'owner');insert into rt_locations(business_id) values(b);return jsonb_build_object('id',b);
 end if;
 if not rt_private.member(b) then raise exception 'Business access denied';end if;
 -- Serialize management and punches for this business, including corrections/publication.
 select * into x from rt_businesses where id=b for update;
 if not rt_private.entitled(b) then raise exception 'Business pilot access has expired; contact Reimage Tech';end if;
 if action='employee' then
  if (p->>'rate')::numeric<=0 or p->>'rate' is null then raise exception 'Enter a positive hourly rate';end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p->'unavailable_days','[]')) v where v.value::int not between 0 and 6) then raise exception 'Invalid unavailable day';end if;
  emp:=nullif(p->>'id','')::uuid;
  if emp is null then insert into rt_employees(business_id,name,role,max_hours,unavailable_days) values(b,trim(p->>'name'),coalesce(p->>'role',''),coalesce((p->>'max_hours')::numeric,40),array(select jsonb_array_elements_text(coalesce(p->'unavailable_days','[]'))::int)) returning id into emp;
  else
   if not exists(select 1 from rt_employees where id=emp and business_id=b) then raise exception 'Employee not found';end if;
   update rt_employees set name=trim(p->>'name'),role=coalesce(p->>'role',''),max_hours=(p->>'max_hours')::numeric,unavailable_days=array(select jsonb_array_elements_text(coalesce(p->'unavailable_days','[]'))::int) where id=emp;
  end if;
  if (p->>'rate')::numeric>0 and not exists(select 1 from rt_rates where employee_id=emp and rate=(p->>'rate')::numeric and effective_at=(select max(effective_at) from rt_rates where employee_id=emp)) then
   insert into rt_rates(business_id,employee_id,effective_at,rate) values(b,emp,now(),(p->>'rate')::numeric);
  elsif not exists(select 1 from rt_rates where employee_id=emp) then raise exception 'Enter a positive hourly rate';end if;
  return jsonb_build_object('id',emp);
 elsif action in ('active','enroll','revoke_devices') then
  emp:=(p->>'employee_id')::uuid;
  if not exists(select 1 from rt_employees where id=emp and business_id=b) then raise exception 'Employee not found';end if;
  if action='active' then update rt_employees set active=(p->>'active')::boolean where id=emp;end if;
  if action in ('active','revoke_devices') then update rt_private.sessions set revoked=true where employee_id=emp;update rt_private.enrollments set used_at=now() where employee_id=emp and used_at is null;end if;
  if action='enroll' then
   if not exists(select 1 from rt_employees where id=emp and active) then raise exception 'Employee is inactive';end if;
   code:=upper(encode(gen_random_bytes(5),'hex'));
   update rt_private.enrollments set used_at=now() where employee_id=emp and used_at is null;
   insert into rt_private.enrollments(business_id,employee_id,code_hash,expires_at) values(b,emp,encode(digest(code,'sha256'),'hex'),now()+interval '24 hours');
   return jsonb_build_object('code',code,'expires_at',now()+interval '24 hours');
  end if;
 elsif action='settings' then
  if x.owner_id<>auth.uid() then raise exception 'Only the owner may change business settings';end if;
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Invalid timezone';end if;
  if ((p->>'timezone')<>x.timezone or (p->>'week_start')::int<>x.week_start) and (exists(select 1 from rt_events where business_id=b) or exists(select 1 from rt_schedules where business_id=b)) then raise exception 'Timezone and workweek are locked after scheduling or attendance begins';end if;
  update rt_businesses set name=trim(p->>'name'),timezone=p->>'timezone',week_start=(p->>'week_start')::int,overtime_hours=(p->>'overtime_hours')::numeric,overtime_multiplier=(p->>'overtime_multiplier')::numeric,paid_breaks=(p->>'paid_breaks')::boolean,weekly_budget=nullif(p->>'weekly_budget','')::numeric,target_labor_percent=(p->>'target_labor_percent')::numeric,minimum_staff=(p->>'minimum_staff')::int,opening_time=(p->>'opening_time')::time,closing_time=(p->>'closing_time')::time where id=b;
  update rt_locations set name=p->>'location_name',geofence=(p->>'geofence')::boolean,latitude=nullif(p->>'latitude','')::float8,longitude=nullif(p->>'longitude','')::float8,radius_m=(p->>'radius_m')::numeric,accuracy_m=(p->>'accuracy_m')::numeric where business_id=b;
  delete from rt_approvals where business_id=b;
 elsif action='manager' then
  if x.owner_id<>auth.uid() then raise exception 'Only the owner may manage access';end if;
  select id into v from auth.users where lower(email)=lower(trim(p->>'email'));
  if v is null then raise exception 'Manager must create a portal account first';end if;
  if v=x.owner_id then raise exception 'Owner access cannot be changed';end if;
  if coalesce((p->>'remove')::boolean,false) then delete from rt_memberships where business_id=b and user_id=v;
  else insert into rt_memberships values(b,v,'manager') on conflict do nothing;end if;
 elsif action='rotate_tag' then update rt_locations set tag=encode(gen_random_bytes(24),'hex') where business_id=b;
 elsif action='schedule' then
  wk:=(p->>'week_start')::date;
  if extract(dow from wk)::int<>x.week_start then raise exception 'Choose the configured workweek start';end if;
  insert into rt_schedules(business_id,name,week_start,revenue) values(b,coalesce(nullif(trim(p->>'name'),''),'Weekly schedule'),wk,coalesce((p->>'revenue')::numeric,0)) returning id into sid;
  return jsonb_build_object('id',sid);
 elsif action in ('shift','delete_shift','publish','draft','delete_schedule','revenue') then
  sid:=(p->>'schedule_id')::uuid;
  if not exists(select 1 from rt_schedules where id=sid and business_id=b) then raise exception 'Schedule not found';end if;
  if action not in ('draft','revenue') and exists(select 1 from rt_schedules where id=sid and status='published') then raise exception 'Return the schedule to draft before editing';end if;
  if action='shift' then
   emp:=(p->>'employee_id')::uuid;v_start:=(p->>'starts_at')::timestamptz;v_end:=(p->>'ends_at')::timestamptz;
   if not exists(select 1 from rt_employees where id=emp and business_id=b and active) then raise exception 'Active employee required';end if;
   select week_start into wk from rt_schedules where id=sid;
   if (v_start at time zone x.timezone)::date<wk or (v_start at time zone x.timezone)::date>=wk+7 then raise exception 'Shift must start within the selected week';end if;
   if exists(select 1 from rt_shifts s join rt_schedules z on z.id=s.schedule_id where s.employee_id=emp and (s.schedule_id=sid or z.status='published') and s.starts_at<v_end and s.ends_at>v_start and s.id<>coalesce(nullif(p->>'id','')::uuid,gen_random_uuid())) then raise exception 'Employee already has an overlapping shift';end if;
   if exists(select 1 from rt_employees where id=emp and extract(dow from v_start at time zone x.timezone)::int=any(unavailable_days)) then raise exception 'Employee is unavailable that day';end if;
   if nullif(p->>'id','') is not null then delete from rt_shifts where id=(p->>'id')::uuid and schedule_id=sid;end if;
   insert into rt_shifts(business_id,schedule_id,employee_id,starts_at,ends_at) values(b,sid,emp,v_start,v_end);
  elsif action='delete_shift' then delete from rt_shifts where id=(p->>'id')::uuid and schedule_id=sid;
  elsif action='delete_schedule' then delete from rt_schedules where id=sid;
  elsif action='revenue' then update rt_schedules set revenue=(p->>'revenue')::numeric where id=sid;
  elsif action='publish' then
   if exists(select 1 from rt_shifts a join rt_shifts c on a.employee_id=c.employee_id and a.id<>c.id and a.starts_at<c.ends_at and a.ends_at>c.starts_at join rt_schedules cs on cs.id=c.schedule_id where a.schedule_id=sid and cs.status='published') then raise exception 'Publication conflicts with an existing published shift';end if;
   if not exists(select 1 from rt_shifts where schedule_id=sid) then raise exception 'Add shifts before publishing';end if;
   update rt_schedules set status='published' where id=sid;
  else update rt_schedules set status='draft' where id=sid;end if;
 elsif action='correction' then
  emp:=(p->>'employee_id')::uuid;
  if not exists(select 1 from rt_employees where id=emp and business_id=b) then raise exception 'Employee not found';end if;
  if p->>'reason' is null or length(trim(p->>'reason'))<3 then raise exception 'A correction reason is required';end if;
  v_start:=(p->>'occurred_at')::timestamptz;
  if v_start>now() then raise exception 'Corrections cannot be in the future';end if;
  if p->>'event_type' not in ('clock_in','break_start','break_end','clock_out') then raise exception 'Invalid event';end if;
  eid:=nullif(p->>'event_id','')::uuid;
  if eid is null then
   insert into rt_events(business_id,employee_id,location_id,event_type,occurred_at,paid_break,source) select b,emp,id,p->>'event_type',v_start,x.paid_breaks,'manager' from rt_locations where business_id=b returning id into eid;
  elsif not exists(select 1 from rt_events where id=eid and employee_id=emp and business_id=b) then raise exception 'Event not found';end if;
  insert into rt_corrections(business_id,event_id,event_type,occurred_at,void,reason,actor_id) values(b,eid,p->>'event_type',v_start,coalesce((p->>'void')::boolean,false),trim(p->>'reason'),auth.uid());
  perform rt_private.validate_timeline(b,emp);
  delete from rt_approvals where employee_id=emp;
 elsif action='approve' then
  emp:=(p->>'employee_id')::uuid;wk:=(p->>'week_start')::date;
  if not exists(select 1 from rt_employees where id=emp and business_id=b) then raise exception 'Employee not found';end if;
  if extract(dow from wk)::int<>x.week_start or ((wk+7)::timestamp at time zone x.timezone)>now() then raise exception 'Only completed workweeks can be approved';end if;
  select event_type into last_type from rt_private.effective_events(b) where employee_id=emp and occurred_at<(wk::timestamp at time zone x.timezone) order by occurred_at desc limit 1;
  if last_type is not null and last_type<>'clock_out' and not exists(select 1 from rt_rates where employee_id=emp and effective_at<=(wk::timestamp at time zone x.timezone)) then raise exception 'Historical wage rate is missing at the workweek boundary';end if;
  select event_type into last_type from rt_private.effective_events(b) where employee_id=emp and occurred_at<((wk+7)::timestamp at time zone x.timezone) order by occurred_at desc limit 1;
  if last_type is not null and last_type<>'clock_out' and not exists(select 1 from rt_private.effective_events(b) where employee_id=emp and occurred_at>=((wk+7)::timestamp at time zone x.timezone) and occurred_at<=now() and event_type='clock_out') then raise exception 'Resolve the open shift before approval';end if;
  if exists(select 1 from rt_private.effective_events(b) e where e.employee_id=emp and e.occurred_at>= (wk::timestamp at time zone x.timezone) and e.occurred_at<((wk+7)::timestamp at time zone x.timezone) and not exists(select 1 from rt_rates r where r.employee_id=emp and r.effective_at<=e.occurred_at)) then raise exception 'Historical wage rate is missing';end if;
  insert into rt_approvals(business_id,employee_id,week_start,actor_id) values(b,emp,wk,auth.uid()) on conflict(employee_id,week_start) do update set actor_id=excluded.actor_id,approved_at=now();
 else raise exception 'Unknown management action';end if;
 return jsonb_build_object('ok',true);
end$$;

revoke all on function public.rt_bootstrap(), public.rt_dashboard(uuid),public.rt_manage(uuid,text,jsonb) from public,anon;
grant execute on function public.rt_bootstrap(),public.rt_dashboard(uuid),public.rt_manage(uuid,text,jsonb) to authenticated;
revoke all on all functions in schema rt_private from public,anon,authenticated;
commit;
