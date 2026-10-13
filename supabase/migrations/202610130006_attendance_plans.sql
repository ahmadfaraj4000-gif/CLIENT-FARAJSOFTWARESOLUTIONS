begin;
-- Attendance is compared against immutable publication snapshots, never mutable drafts.
alter table public.rt_businesses add column tolerance_minutes int not null default 5 check(tolerance_minutes between 0 and 60);
alter table public.rt_businesses add column matching_window_minutes int not null default 240 check(matching_window_minutes between 15 and 720);
alter table public.rt_shifts add column planned_break_start timestamptz;
alter table public.rt_shifts add column planned_break_minutes int not null default 0;
alter table public.rt_shifts add column planned_break_paid boolean not null default false;
alter table public.rt_shifts add constraint rt_valid_planned_break check (
 (planned_break_minutes=0 and planned_break_start is null) or
 (planned_break_minutes>0 and planned_break_minutes<=480 and planned_break_start is not null and planned_break_start>=starts_at and planned_break_start+planned_break_minutes*interval '1 minute'<=ends_at));
create table public.rt_shift_plans (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references rt_businesses(id),employee_id uuid not null references rt_employees(id),
 source_shift_id uuid not null,schedule_id uuid not null,starts_at timestamptz not null,ends_at timestamptz not null,
 planned_break_start timestamptz,planned_break_minutes int not null,planned_break_paid boolean not null,
 active boolean not null default true,published_at timestamptz not null default now()
);
create unique index rt_active_plan on public.rt_shift_plans(source_shift_id) where active;
create index rt_plan_business on public.rt_shift_plans(business_id,starts_at);
insert into public.rt_shift_plans(business_id,employee_id,source_shift_id,schedule_id,starts_at,ends_at,planned_break_start,planned_break_minutes,planned_break_paid)
 select s.business_id,s.employee_id,s.id,s.schedule_id,s.starts_at,s.ends_at,s.planned_break_start,s.planned_break_minutes,s.planned_break_paid from rt_shifts s join rt_schedules z on z.id=s.schedule_id where z.status='published';
create table public.rt_attendance_reviews (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references rt_businesses(id),employee_id uuid not null references rt_employees(id),
 item_key text not null,clock_in_id uuid references rt_events(id),plan_id uuid references rt_shift_plans(id),decision text not null check(decision in ('review','match','unscheduled')),
 fingerprint text not null,reason text not null check(length(trim(reason)) between 3 and 1000),actor_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
alter table rt_shift_plans enable row level security;
alter table rt_attendance_reviews enable row level security;
revoke all on rt_shift_plans,rt_attendance_reviews from public,anon,authenticated;
create function rt_private.attendance_revision(b uuid) returns text language sql stable security definer set search_path=public,extensions,pg_temp as $$
 select encode(digest(jsonb_build_array(
 (select jsonb_agg(e order by id) from rt_private.effective_events(b)e),
 (select jsonb_agg(p order by id) from rt_shift_plans p where business_id=b),
 (select jsonb_agg(r order by id) from rt_attendance_reviews r where business_id=b),
 (select to_jsonb(x) from rt_businesses x where id=b))::text,'sha256'),'hex')
$$;
-- An early clock-in also freezes the plan used to interpret that attendance.
create function rt_private.plan_started(pid uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from rt_shift_plans p join rt_businesses b on b.id=p.business_id where p.id=pid and
 (p.starts_at<=now() or exists(select 1 from rt_private.effective_events(b.id)e where e.employee_id=p.employee_id and e.event_type='clock_in' and e.occurred_at<=now() and
 (abs(extract(epoch from e.occurred_at-p.starts_at))<=b.matching_window_minutes*60 or (e.occurred_at>=p.starts_at and e.occurred_at<p.ends_at)))))
$$;
create function rt_private.protect_plan() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 if exists(select 1 from rt_shift_plans where source_shift_id=old.id and active and rt_private.plan_started(id)) then raise exception 'A started published shift is preserved for attendance comparison; record an attendance correction if needed';end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
create trigger rt_protect_plan before update or delete on rt_shifts for each row execute function rt_private.protect_plan();
create function rt_private.publish_plan() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 if tg_op='DELETE' then
  if exists(select 1 from rt_shift_plans where schedule_id=old.id) then raise exception 'Published schedule history cannot be deleted';end if;return old;
 end if;
 if new.status='published' and old.status<>'published' then
  if exists(select 1 from rt_shifts s join rt_shift_plans p on p.business_id=s.business_id and p.employee_id=s.employee_id and p.active and p.schedule_id<>s.schedule_id and p.starts_at<s.ends_at and p.ends_at>s.starts_at where s.schedule_id=new.id and (rt_private.plan_started(p.id) or exists(select 1 from rt_schedules ps where ps.id=p.schedule_id and ps.week_start<>new.week_start))) then raise exception 'Publication conflicts with a published attendance baseline';end if;
  update rt_shift_plans set active=false where business_id=new.business_id and schedule_id in (select id from rt_schedules where business_id=new.business_id and week_start=new.week_start) and active and not rt_private.plan_started(id);
  insert into rt_shift_plans(business_id,employee_id,source_shift_id,schedule_id,starts_at,ends_at,planned_break_start,planned_break_minutes,planned_break_paid)
   select s.business_id,s.employee_id,s.id,s.schedule_id,s.starts_at,s.ends_at,s.planned_break_start,s.planned_break_minutes,s.planned_break_paid from rt_shifts s where s.schedule_id=new.id and not exists(select 1 from rt_shift_plans p where p.source_shift_id=s.id and p.active);
 end if;return new;
end$$;
create trigger rt_publish_plan after update of status on rt_schedules for each row execute function rt_private.publish_plan();
create trigger rt_keep_schedule before delete on rt_schedules for each row execute function rt_private.publish_plan();
create or replace function public.rt_manage(b uuid,action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
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
  update rt_businesses set name=trim(p->>'name'),timezone=p->>'timezone',week_start=(p->>'week_start')::int,overtime_hours=(p->>'overtime_hours')::numeric,overtime_multiplier=(p->>'overtime_multiplier')::numeric,paid_breaks=(p->>'paid_breaks')::boolean,tolerance_minutes=coalesce((p->>'tolerance_minutes')::int,x.tolerance_minutes),matching_window_minutes=coalesce((p->>'matching_window_minutes')::int,x.matching_window_minutes),weekly_budget=nullif(p->>'weekly_budget','')::numeric,target_labor_percent=(p->>'target_labor_percent')::numeric,minimum_staff=(p->>'minimum_staff')::int,opening_time=(p->>'opening_time')::time,closing_time=(p->>'closing_time')::time where id=b;
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
   v:=nullif(p->>'id','')::uuid;
   if v is not null and not exists(select 1 from rt_shifts where id=v and schedule_id=sid) then raise exception 'Shift not found';end if;
   if v is null then
    insert into rt_shifts(business_id,schedule_id,employee_id,starts_at,ends_at,planned_break_start,planned_break_minutes,planned_break_paid)
    values(b,sid,emp,v_start,v_end,nullif(p->>'planned_break_start','')::timestamptz,coalesce((p->>'planned_break_minutes')::int,0),coalesce((p->>'planned_break_paid')::boolean,x.paid_breaks));
   else
    update rt_shifts set employee_id=emp,starts_at=v_start,ends_at=v_end,planned_break_start=nullif(p->>'planned_break_start','')::timestamptz,planned_break_minutes=coalesce((p->>'planned_break_minutes')::int,0),planned_break_paid=coalesce((p->>'planned_break_paid')::boolean,x.paid_breaks) where id=v;
   end if;
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
create or replace function public.rt_dashboard(b uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not rt_private.member(b) then raise exception 'Business access denied';end if;
 if not rt_private.entitled(b) then raise exception 'Shift Planner access has expired; contact Reimage Tech' using errcode='42501';end if;
 return jsonb_build_object(
 'plans',coalesce((select jsonb_agg(x) from rt_shift_plans x where business_id=b),'[]'::jsonb),
 'attendance_reviews',coalesce((select jsonb_agg(x order by created_at,id) from rt_attendance_reviews x where business_id=b),'[]'::jsonb),
 'attendance_revision',rt_private.attendance_revision(b),
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

create function public.rt_review_attendance(b uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare emp uuid;plan uuid:=nullif(p->>'plan_id','')::uuid;ev uuid:=nullif(p->>'clock_in_id','')::uuid;decision text:=p->>'decision';
begin
 if not rt_private.member(b) then raise exception 'Business access denied';end if;
 perform 1 from rt_businesses where id=b for update;
 if not rt_private.entitled(b) then raise exception 'Shift Planner access has expired' using errcode='42501';end if;
 if (p->>'revision') is distinct from rt_private.attendance_revision(b) then raise exception 'Attendance changed. Refresh and review again';end if;
 if length(coalesce(p->>'fingerprint','')) not between 1 and 20000 then raise exception 'Review fingerprint required';end if;
 if ev is not null then
  select employee_id into emp from rt_private.effective_events(b) where id=ev and event_type='clock_in';
  if emp is null then raise exception 'Clock-in not found';end if;
 else
  select employee_id into emp from rt_shift_plans where id=plan and business_id=b and active;
  if emp is null or decision<>'review' then raise exception 'Published plan required';end if;
 end if;
 if plan is not null and not exists(select 1 from rt_shift_plans where id=plan and business_id=b and employee_id=emp and active) then raise exception 'Plan must belong to the same employee and business';end if;
 if decision='match' and (plan is null or ev is null) then raise exception 'Choose a shift and clock-in';end if;
 if decision='unscheduled' and (ev is null or plan is not null) then raise exception 'Unscheduled work requires a clock-in only';end if;
 insert into rt_attendance_reviews(business_id,employee_id,item_key,clock_in_id,plan_id,decision,fingerprint,reason,actor_id)
 values(b,emp,case when ev is not null then 'session:'||ev else 'plan:'||plan end,ev,plan,decision,p->>'fingerprint',trim(p->>'reason'),auth.uid());
 delete from rt_approvals where employee_id=emp;
 return jsonb_build_object('ok',true);
end$$;
-- Both subscriptions are checked on each import; managers inherit only the business's planner access.
create function public.rt_pricing_labor(b uuid,w date,basis text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb;x rt_businesses;lo timestamptz;hi timestamptz;e record;
begin
 if not rt_private.member(b) then raise exception 'Business access denied';end if;
 if not exists(select 1 from subscriptions where user_id=auth.uid() and product='pricing_assistant_pro' and status in ('active','trialing','paid') and (expires_at is null or expires_at>now()) and(current_period_end is null or current_period_end>now())) then raise exception 'Active Pricing Assistant access is required' using errcode='42501';end if;
 perform 1 from rt_businesses where id=b for update;
 d:=public.rt_dashboard(b);
 select * into x from rt_businesses where id=b;
 if extract(dow from w)::int<>x.week_start then raise exception 'Choose the configured workweek start';end if;
 if basis not in ('scheduled','actual','forecast') or basis is null then raise exception 'Invalid labor basis';end if;
 lo:=w::timestamp at time zone x.timezone;hi:=(w+7)::timestamp at time zone x.timezone;
 if basis='actual' then
  if hi>now() then raise exception 'Approved actual imports require a completed workweek';end if;
  for e in select a.employee_id,a.occurred_at,lead(a.occurred_at) over(partition by a.employee_id order by a.occurred_at) next_at,a.event_type from rt_private.effective_events(b)a loop
   if e.event_type<>'clock_out' and e.occurred_at<hi and coalesce(e.next_at,now())>lo then
    if not exists(select 1 from rt_approvals where business_id=b and employee_id=e.employee_id and week_start=w) then raise exception 'Approve every worked timesheet before importing actual labor';end if;
   end if;
  end loop;
 end if;
 return d||jsonb_build_object('import_week',w,'import_basis',basis,'as_of',clock_timestamp());
end$$;
revoke all on function public.rt_review_attendance(uuid,jsonb),public.rt_pricing_labor(uuid,date,text) from public,anon;
grant execute on function public.rt_review_attendance(uuid,jsonb),public.rt_pricing_labor(uuid,date,text) to authenticated;
revoke all on all functions in schema rt_private from public,anon,authenticated;

create or replace function public.rt_clock(action text,p jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare loc rt_locations;bus rt_businesses; ses rt_private.sessions;en rt_private.enrollments;emp rt_employees;ev rt_events; latest record;state text;token text;attempt int;dist float8;now_at timestamptz:=clock_timestamp(); typ text;approved boolean:=false;
begin
 select * into loc from rt_locations where tag=p->>'tag';
 if loc.id is null then return jsonb_build_object('error','This clock link is inactive. Ask your manager for the current link.');end if;
 select * into bus from rt_businesses where id=loc.business_id for update;
 if action='enroll' then
  -- Persist failed attempts by returning errors rather than rolling the transaction back.
  insert into rt_private.attempts(key) values(loc.id::text||':'||coalesce(p->>'client_key','unknown')) on conflict(key) do update set attempts=case when rt_private.attempts.window_at<now_at-interval '15 minutes' then 1 else rt_private.attempts.attempts+1 end,window_at=case when rt_private.attempts.window_at<now_at-interval '15 minutes' then now_at else rt_private.attempts.window_at end returning attempts into attempt;
  if attempt>10 then return jsonb_build_object('error','Too many enrollment attempts. Try again in 15 minutes.');end if;
  if not rt_private.entitled(bus.id) then return jsonb_build_object('error','Clock access is paused. Contact your manager.');end if;
  select * into en from rt_private.enrollments where business_id=bus.id and code_hash=encode(digest(upper(trim(p->>'code')),'sha256'),'hex') and used_at is null and expires_at>now_at limit 1 for update;
  if en.id is null or not exists(select 1 from rt_employees where id=en.employee_id and active) then return jsonb_build_object('error','Code is invalid or expired. Ask your manager for a new code.');end if;
  token:=encode(gen_random_bytes(32),'hex');
  update rt_private.sessions set revoked=true where employee_id=en.employee_id;
  insert into rt_private.sessions(business_id,employee_id,token_hash,expires_at) values(bus.id,en.employee_id,encode(digest(token,'sha256'),'hex'),now_at+interval '180 days');
  update rt_private.enrollments set used_at=now_at where id=en.id;
  return jsonb_build_object('token',token);
 end if;
 select * into ses from rt_private.sessions where business_id=bus.id and token_hash=encode(digest(coalesce(p->>'token',''),'sha256'),'hex') and not revoked and expires_at>now_at;
 if ses.id is null then return jsonb_build_object('status','enrollment_required','business',bus.name,'location',loc.name);end if;
 select * into emp from rt_employees where id=ses.employee_id and active;
 if emp.id is null then return jsonb_build_object('status','enrollment_required','business',bus.name);end if;
 select * into latest from rt_private.effective_events(bus.id) where employee_id=emp.id order by occurred_at desc limit 1;
 state:=case latest.event_type when 'clock_in' then 'working' when 'break_end' then 'working' when 'break_start' then 'break' else 'off' end;
 if action='forget' then update rt_private.sessions set revoked=true where id=ses.id;return jsonb_build_object('ok',true);end if;
 if action='punch' then
  typ:=p->>'event_type';
  select * into ev from rt_events where request_id=(p->>'request_id')::uuid;
  if ev.id is not null then
   if ev.employee_id<>emp.id or ev.event_type<>typ or ev.session_id<>ses.id then return jsonb_build_object('error','Request conflict. Refresh and try again.');end if;
   return jsonb_build_object('event',to_jsonb(ev),'replayed',true);
  end if;
  if not rt_private.entitled(bus.id) and typ not in ('break_end','clock_out') then return jsonb_build_object('error','Clock access is paused. Contact your manager.');end if;
  if (state='off' and typ<>'clock_in') or (state='working' and typ not in ('break_start','clock_out')) or (state='break' and typ not in ('break_end','clock_out')) or typ is null then return jsonb_build_object('error','Your status changed. Refresh before trying again.');end if;
  if latest.occurred_at>now_at-interval '3 seconds' then return jsonb_build_object('error','Please wait a few seconds before another clock action.');end if;
  if loc.geofence then
   if p->>'latitude' is null or p->>'longitude' is null or p->>'accuracy' is null or p->>'captured_at' is null or not ((p->>'latitude')::float8 between -90 and 90) or not ((p->>'longitude')::float8 between -180 and 180) or not ((p->>'accuracy')::float8 between 0 and loc.accuracy_m) or (p->>'captured_at')::timestamptz<now_at-interval '30 seconds' or (p->>'captured_at')::timestamptz>now_at+interval '5 seconds' then return jsonb_build_object('error','A fresh, accurate location is required. Allow location access and retry.');end if;
   dist:=6371000*2*asin(sqrt(least(1,power(sin(radians((p->>'latitude')::float8-loc.latitude)/2),2)+cos(radians(loc.latitude))*cos(radians((p->>'latitude')::float8))*power(sin(radians((p->>'longitude')::float8-loc.longitude)/2),2))));
   if dist+(p->>'accuracy')::float8>loc.radius_m then return jsonb_build_object('error','You must be within the workplace clock area. Retry near the business or ask your manager for a correction.');end if;
   approved:=true;
  end if;
  insert into rt_events(business_id,employee_id,location_id,event_type,occurred_at,paid_break,session_id,request_id,location_verified) values(bus.id,emp.id,loc.id,typ,now_at,case when typ='break_end' or (state='break' and typ='clock_out') then latest.paid_break else bus.paid_breaks end,ses.id,(p->>'request_id')::uuid,approved) returning * into ev;
  return jsonb_build_object('event',to_jsonb(ev));
 end if;
 if action<>'state' then return jsonb_build_object('error','Unknown clock action');end if;
 return jsonb_build_object('status','ready','business',bus.name,'location',loc.name,'employee',emp.name,'timezone',bus.timezone,'state',state,'geofence',loc.geofence,'entitled',rt_private.entitled(bus.id),
 'schedule',coalesce((select jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at,'planned_break_start',s.planned_break_start,'planned_break_minutes',s.planned_break_minutes,'planned_break_paid',s.planned_break_paid) order by s.starts_at) from rt_shift_plans s where s.employee_id=emp.id and s.active and s.ends_at>now_at-interval '1 day' and s.starts_at<now_at+interval '14 days'),'[]'::jsonb));
end$$;
commit;
