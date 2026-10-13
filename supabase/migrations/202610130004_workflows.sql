begin;
create table public.rt_rate_audit(id uuid primary key default gen_random_uuid(),business_id uuid references public.rt_businesses(id),employee_id uuid references public.rt_employees(id),actor_id uuid references auth.users(id),reason text not null,created_at timestamptz default now());
alter table public.rt_rate_audit enable row level security;
revoke all on public.rt_rate_audit from anon,authenticated;
create function public.rt_add_rate(b uuid,emp uuid,rate numeric,effective timestamptz,reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not rt_private.member(b) or not rt_private.entitled(b) then raise exception 'Business access denied';end if;
 perform 1 from rt_businesses where id=b for update;
 if not exists(select 1 from rt_employees where id=emp and business_id=b) or rate<=0 or rate is null or effective is null or effective>now() or length(trim(reason))<3 or reason is null then raise exception 'Valid employee, historical date, positive rate, and reason required';end if;
 insert into rt_rates(business_id,employee_id,effective_at,rate) values(b,emp,effective,rate);
 insert into rt_rate_audit(business_id,employee_id,actor_id,reason) values(b,emp,auth.uid(),reason);
 delete from rt_approvals where employee_id=emp;
 return '{"ok":true}';
end$$;
create function public.rt_save_proposal(b uuid,w date,items jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; item jsonb;
begin
 if jsonb_array_length(items)>200 or jsonb_array_length(items)=0 then raise exception 'Proposal must contain 1–200 shifts';end if;
 result:=rt_manage(b,'schedule',jsonb_build_object('week_start',w,'name','Suggested week of '||w));
 for item in select value from jsonb_array_elements(items) loop perform rt_manage(b,'shift',item||jsonb_build_object('schedule_id',result->>'id'));end loop;
 return result;
end$$;
revoke all on function public.rt_add_rate(uuid,uuid,numeric,timestamptz,text),public.rt_save_proposal(uuid,date,jsonb) from public,anon;
grant execute on function public.rt_add_rate(uuid,uuid,numeric,timestamptz,text),public.rt_save_proposal(uuid,date,jsonb) to authenticated;
commit;
