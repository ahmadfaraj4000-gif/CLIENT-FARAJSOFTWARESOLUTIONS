begin;
-- Service-role-only entry point: the Edge Function never trusts client employee/business IDs.
create function public.rt_clock(action text,p jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
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
 'schedule',coalesce((select jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at) order by s.starts_at) from rt_shifts s join rt_schedules z on z.id=s.schedule_id where s.employee_id=emp.id and z.status='published' and s.ends_at>now_at-interval '1 day' and s.starts_at<now_at+interval '14 days'),'[]'::jsonb));
end$$;
revoke all on function public.rt_clock(text,jsonb) from public,anon,authenticated;
grant execute on function public.rt_clock(text,jsonb) to service_role;
commit;
