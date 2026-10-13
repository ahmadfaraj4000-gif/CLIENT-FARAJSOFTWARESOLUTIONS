begin;
create function public.rt_import_schedule(b uuid,legacy uuid,confirmed_week date) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare bus rt_businesses; old shift_planner_schedules;person jsonb;s jsonb;emp uuid;sid uuid;starts timestamptz;ends timestamptz;d date;weekday int;
begin
 if not rt_private.member(b) or not rt_private.entitled(b) then raise exception 'Business access denied';end if;
 select * into bus from rt_businesses where id=b for update;
 if bus.owner_id<>auth.uid() then raise exception 'Only the owner can import legacy schedules';end if;
 select * into old from shift_planner_schedules where id=legacy and user_id=auth.uid();
 if old.id is null then raise exception 'Legacy schedule not found';end if;
 select id into sid from rt_schedules where legacy_id=legacy;
 if sid is not null then return jsonb_build_object('id',sid,'already_imported',true);end if;
 if confirmed_week is null or extract(dow from confirmed_week)::int<>bus.week_start then raise exception 'Confirm the historical workweek start date';end if;
 for person in select value from jsonb_array_elements(old.schedule_data->'employees') loop
  if coalesce(person->>'emp_id','')='' then raise exception 'Missing legacy employee identity; review required';end if;
  select id into emp from rt_employees where business_id=b and legacy_id=person->>'emp_id';
  if emp is not null and exists(select 1 from rt_employees where id=emp and lower(name)<>lower(person->>'name')) then raise exception 'Legacy identity has conflicting names; review required';end if;
  if emp is null then
   if exists(select 1 from rt_employees where business_id=b and lower(name)=lower(person->>'name')) then raise exception 'Employee name matches another identity; review required before import';end if;
   insert into rt_employees(business_id,name,role,max_hours,unavailable_days,legacy_id) values(b,person->>'name',coalesce(person->>'role',''),coalesce((person->>'max_hours')::numeric,40),array(select (value::int+1)%7 from jsonb_array_elements_text(coalesce(person->'unavailable_days','[]'))),person->>'emp_id') returning id into emp;
  end if;
  if not exists(select 1 from rt_rates where employee_id=emp and effective_at=(confirmed_week::timestamp at time zone bus.timezone)) then
   insert into rt_rates(business_id,employee_id,effective_at,rate) values(b,emp,confirmed_week::timestamp at time zone bus.timezone,(person->>'wage')::numeric);
  elsif exists(select 1 from rt_rates where employee_id=emp and effective_at=(confirmed_week::timestamp at time zone bus.timezone) and rate<>(person->>'wage')::numeric) then raise exception 'Historical wage conflict; review required';end if;
 end loop;
 insert into rt_schedules(business_id,name,week_start,legacy_id,revenue) values(b,coalesce(old.name,'Imported schedule'),confirmed_week,legacy,case when old.schedule_data->>'revenueMode'='weekly' then coalesce(nullif(old.schedule_data->>'weeklyRevenue','')::numeric,0) else coalesce((select sum(coalesce(nullif(value,'')::numeric,0)) from jsonb_array_elements_text(old.schedule_data->'dailyRevenue')),0) end) returning id into sid;
 for s in select value from jsonb_each(coalesce(old.schedule_data->'shifts','{}')) loop
  select id into emp from rt_employees where business_id=b and legacy_id=s->>'emp_id';
  if emp is null then raise exception 'Shift references an unknown employee';end if;
  weekday:=((s->>'day_idx')::int+1)%7;
  d:=confirmed_week+((weekday-bus.week_start+7)%7);
  starts:=(d::text||' '||(s->>'start'))::timestamp at time zone bus.timezone;
  ends:=(d::text||' '||(s->>'end'))::timestamp at time zone bus.timezone;
  if to_char(starts at time zone bus.timezone,'HH24:MI')<>left(s->>'start',5) or to_char(ends at time zone bus.timezone,'HH24:MI')<>left(s->>'end',5) or ((starts-interval '1 hour') at time zone bus.timezone)=(starts at time zone bus.timezone) or ((ends-interval '1 hour') at time zone bus.timezone)=(ends at time zone bus.timezone) then raise exception 'Legacy shift crosses an ambiguous or nonexistent clock time; recreate this shift with an explicit DST choice';end if;
  if ends<=starts then ends:=((d+1)::text||' '||(s->>'end'))::timestamp at time zone bus.timezone;end if;
  insert into rt_shifts(business_id,schedule_id,employee_id,starts_at,ends_at) values(b,sid,emp,starts,ends);
 end loop;
 return jsonb_build_object('id',sid);
end$$;
revoke all on function public.rt_import_schedule(uuid,uuid,date) from public,anon;
grant execute on function public.rt_import_schedule(uuid,uuid,date) to authenticated;
commit;
