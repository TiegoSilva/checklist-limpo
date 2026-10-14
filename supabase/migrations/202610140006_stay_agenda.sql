-- A reserva é a fonte única das datas; tarefas futuras não iniciam a preparação.
alter table public.reservations add column inspector uuid references public.profiles,
 add column cleaner uuid references public.profiles, add column checkout_time time not null default '12:00',
 add column revision integer not null default 0;
alter table public.preparation_cycles add column reservation_id uuid unique references public.reservations;
create index reservations_unit_dates on public.reservations(unit_id,checkin,checkout);

create view public.team_agenda with (security_barrier=true) as
 select r.id,r.unit_id,r.guests,r.checkin,r.checkout,r.checkout_time,r.revision,r.inspector,r.cleaner,
 c.id as cycle_id,
 (select status from activities where cycle_id=c.id and kind='inspection' limit 1) inspection_status,
 (select status from activities where cycle_id=c.id and kind='cleaning' limit 1) cleaning_status
 from reservations r left join preparation_cycles c on c.reservation_id=r.id where can_unit(r.unit_id);
grant select on public.team_agenda to authenticated;

create table public.agenda_changes(id uuid primary key default gen_random_uuid(),unit_id uuid not null references public.units,reservation_id uuid not null references public.reservations,created_at timestamptz not null default now());
alter table public.agenda_changes enable row level security;
create policy agenda_read on public.agenda_changes for select to authenticated using(can_unit(unit_id));
grant select on public.agenda_changes to authenticated;
alter publication supabase_realtime add table public.agenda_changes;

create function public.notify_agenda(u uuid,r uuid,title text) returns void language plpgsql security definer set search_path=public as $$
declare person record; label text; begin
 select name into label from units where id=u;
 for person in select distinct m.user_id from units x join properties p on p.id=x.property_id join memberships m on m.org_id=p.org_id join profiles pr on pr.id=m.user_id
 where x.id=u and pr.active and ('admin'=any(m.roles) or exists(select 1 from user_property_access a where a.property_id=p.id and a.user_id=m.user_id)) loop
 perform notify(person.user_id,null,title,label||' · Consulte a agenda da equipe'); end loop;
 insert into agenda_changes(unit_id,reservation_id) values(u,r);
end $$;

alter function public.confirm_reservation(jsonb) rename to confirm_reservation_legacy;
revoke all on function public.confirm_reservation_legacy(jsonb) from public,anon,authenticated;

-- Uma próxima entrada também atualiza a ocupação de limpezas ainda não iniciadas.
create function public.refresh_scheduled_occupancy(u uuid) returns void language plpgsql security definer set search_path=public as $$
declare a record; target integer; next_occ integer; begin
 for a in select x.id,x.cycle_id,x.occupancy,x.template_id,r.checkout,r.id as reservation_id
 from activities x join preparation_cycles c on c.id=x.cycle_id join reservations r on r.id=c.reservation_id
 where x.unit_id=u and x.kind='cleaning' and x.status='pending' and x.started_at is null for update of x loop
   select guests into next_occ from reservations where unit_id=u and id<>a.reservation_id and checkin>=a.checkout order by checkin,id limit 1;
   select coalesce(next_occ,base_occupancy) into target from units where id=u;
   update preparation_cycles set occupancy=target,occupancy_source=case when next_occ is null then 'base' else 'reservation' end where id=a.cycle_id;
   if target<>a.occupancy then
     update activities set occupancy=target,items=applicable_items((select items from checklist_template_versions where id=a.template_id),target),revision=revision+1 where id=a.id;
   end if;
 end loop;
end $$;

create function public.register_checkin(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare u units; r reservations; c uuid; k text; person uuid; t checklist_template_versions; occ integer; next_occ integer; complement uuid;
begin
 select * into u from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 select * into r from reservations where id=(payload->>'event_id')::uuid;
 if r.id is not null then
   if r.unit_id<>u.id then raise exception 'Identificador já utilizado'; end if;
   return r.id;
 end if;
 if coalesce(trim(payload->>'guest_name'),'')='' or (payload->>'guests')::integer is null or (payload->>'guests')::integer not between 1 and u.capacity
 or (payload->>'checkin')::date is null or (payload->>'checkout')::date is null or (payload->>'checkout')::date<(payload->>'checkin')::date then raise exception 'Dados da hospedagem inválidos'; end if;
 if exists(select 1 from reservations where unit_id=u.id and checkin<(payload->>'checkout')::date and checkout>(payload->>'checkin')::date) then raise exception 'Há outra hospedagem neste período'; end if;
 if not assignee_allowed(u.id,coalesce(payload->>'inspector',payload->>'assignee')::uuid,'inspection') or not assignee_allowed(u.id,coalesce(payload->>'cleaner',payload->>'assignee')::uuid,'cleaning') then raise exception 'Escolha responsáveis com função e acesso à unidade'; end if;
 if u.operational_status='ready' then
   complement:=confirm_reservation_legacy(payload||jsonb_build_object('assignee',coalesce(payload->>'cleaner',payload->>'assignee'),'due_at',coalesce((payload->>'due_at')::timestamptz,((payload->>'checkin')::date+time '14:00') at time zone 'America/Sao_Paulo')));
 else
   insert into reservations(id,unit_id,guest_name,guests,checkin,checkout) values((payload->>'event_id')::uuid,u.id,trim(payload->>'guest_name'),(payload->>'guests')::integer,(payload->>'checkin')::date,(payload->>'checkout')::date);
 end if;
 update reservations set inspector=coalesce(payload->>'inspector',payload->>'assignee')::uuid,cleaner=coalesce(payload->>'cleaner',payload->>'assignee')::uuid,checkout_time=coalesce(nullif(payload->>'checkout_time','')::time,time '12:00') where id=(payload->>'event_id')::uuid returning * into r;
 select guests into next_occ from reservations where unit_id=u.id and id<>r.id and checkin>=r.checkout order by checkin,id limit 1;
 occ:=coalesce(next_occ,u.base_occupancy);
 insert into stays(id,unit_id,guest_name,guests,checkin,checkout) values(r.id,u.id,r.guest_name,r.guests,r.checkin,r.checkout);
 insert into preparation_cycles(stay_id,unit_id,occupancy,occupancy_source,reservation_id) values(r.id,u.id,occ,case when next_occ is null then 'base' else 'reservation' end,r.id) returning id into c;
 foreach k in array array['inspection','cleaning'] loop
   select * into t from checklist_template_versions where unit_id=u.id and kind=k order by version desc limit 1;
   if t.id is null then raise exception 'Publique os dois checklists da unidade primeiro'; end if;
   person:=case when k='inspection' then r.inspector else r.cleaner end;
   if jsonb_array_length(applicable_items(t.items,case when k='inspection' then r.guests else occ end))=0 then raise exception 'Checklist sem itens aplicáveis à ocupação'; end if;
   insert into activities(unit_id,cycle_id,kind,title,assignee,due_at,occupancy,template_id,items)
   values(u.id,c,k,case when k='inspection' then 'Vistoria de checkout' else 'Limpeza, arrumação e check-in' end,person,(r.checkout+r.checkout_time) at time zone 'America/Sao_Paulo',case when k='inspection' then r.guests else occ end,t.id,applicable_items(t.items,case when k='inspection' then r.guests else occ end));
 end loop;
 perform refresh_scheduled_occupancy(u.id);
 perform audit(u.property_id,r.id,'checkin.registered',null,payload-'guest_name');
 perform notify_agenda(u.id,r.id,'Check-in e checkout programados');
 return r.id;
end $$;

-- Compatibilidade com clientes anteriores que esperam o ID de adequação.
create function public.confirm_reservation(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare r uuid; a uuid; begin
 if exists(select 1 from reservations where id=(payload->>'event_id')::uuid and can_unit(unit_id,true)) then return null; end if;
 r:=register_checkin(payload);
 select id into a from activities where unit_id=(payload->>'unit_id')::uuid and kind='complement' order by created_at desc limit 1;
 return a;
end $$;

create function public.reschedule_checkout(reservation uuid,expected_revision integer,payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r reservations; u units; c uuid; d date; tm time; begin
 select * into r from reservations where id=reservation;
 select * into u from units where id=r.unit_id for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 select * into r from reservations where id=reservation for update;
 if expected_revision is null or r.revision<>expected_revision then raise exception 'A hospedagem foi alterada. Atualize a agenda'; end if;
 d:=(payload->>'checkout')::date; tm:=coalesce(nullif(payload->>'checkout_time','')::time,r.checkout_time);
 if d is null or d<r.checkin or length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Informe uma saída válida e justifique a alteração'; end if;
 if exists(select 1 from reservations where unit_id=u.id and id<>r.id and checkin<d and checkout>r.checkin) then raise exception 'A nova saída conflita com outra hospedagem'; end if;
 select id into c from preparation_cycles where reservation_id=r.id;
 perform 1 from activities where cycle_id=c for update;
 if exists(select 1 from activities where cycle_id=c and (status<>'pending' or started_at is not null)) then raise exception 'A preparação já foi iniciada; o histórico deve ser preservado'; end if;
 update reservations set checkout=d,checkout_time=tm,revision=revision+1 where id=r.id;
 update stays set checkout=d where id=r.id;
 update activities set due_at=(d+tm) at time zone 'America/Sao_Paulo',revision=revision+1 where cycle_id=c and kind in('inspection','cleaning');
 perform refresh_scheduled_occupancy(u.id);
 perform audit(u.property_id,r.id,'checkout.rescheduled',jsonb_build_object('checkout',r.checkout,'checkout_time',r.checkout_time),payload,payload->>'reason');
 perform notify_agenda(u.id,r.id,'Data do checkout alterada');
end $$;

-- A agenda controla as duas tarefas como um único compromisso.
alter function public.activity_action(uuid,integer,text,jsonb) rename to activity_action_legacy;
revoke all on function public.activity_action_legacy(uuid,integer,text,jsonb) from public,anon,authenticated;
create function public.activity_action(activity uuid,expected_revision integer,action text,payload jsonb default '{}') returns integer language plpgsql security definer set search_path=public as $$
declare a activities; linked uuid; result integer; begin
 select * into a from activities where id=activity;
 -- Mesma ordem de bloqueio das alterações da agenda.
 perform 1 from units where id=a.unit_id for update;
 select * into a from activities where id=activity;
 select reservation_id into linked from preparation_cycles where id=a.cycle_id;
 if linked is not null then
   if action in('schedule','cancel') then raise exception 'Altere a saída pela agenda da equipe'; end if;
   if action='start' and (a.due_at at time zone 'America/Sao_Paulo')::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Esta tarefa está programada para uma saída futura'; end if;
 end if;
 result:=activity_action_legacy(activity,expected_revision,action,payload);
 if linked is not null and action='start' then update units set operational_status='preparing' where id=a.unit_id; end if;
 if linked is not null and action in('start','submit','approve','reject') then insert into agenda_changes(unit_id,reservation_id) values(a.unit_id,linked); end if;
 return result;
end $$;

revoke all on function public.refresh_scheduled_occupancy(uuid),public.notify_agenda(uuid,uuid,text),public.register_checkin(jsonb),public.confirm_reservation(jsonb),public.reschedule_checkout(uuid,integer,jsonb),public.activity_action(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.register_checkin(jsonb),public.confirm_reservation(jsonb),public.reschedule_checkout(uuid,integer,jsonb),public.activity_action(uuid,integer,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
