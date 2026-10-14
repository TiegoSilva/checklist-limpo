-- Modelos são reutilizáveis; cada OS guarda uma versão e sua execução independente.
alter table public.service_orders
 add column order_type text not null default 'general' check(order_type in('general','checkin','checkout')),
 add column execution_mode text not null default 'task' check(execution_mode in('task','checklist')),
 add column template_id uuid references public.checklist_template_versions,
 add column activity_id uuid unique references public.activities,
 add column reservation_id uuid references public.reservations,
 add column parent_order_id uuid unique references public.service_orders,
 add constraint service_execution check((execution_mode='task' and activity_id is null and template_id is null) or (execution_mode='checklist' and activity_id is not null and template_id is not null));
create unique index service_stay_type on public.service_orders(reservation_id,order_type) where reservation_id is not null and order_type in('checkin','checkout');

-- Checklist usa as exigências de evidência do modelo; tarefa mantém foto de conclusão.
create or replace function public.require_service_evidence() returns trigger language plpgsql security definer set search_path=public as $$
declare a activities; begin
 if new.status='review' and old.status<>new.status then
   if new.execution_mode='checklist' then
     select * into a from activities where id=new.activity_id;
     if a.id is null or a.status<>'review' then raise exception 'Envie a execução do checklist para revisão'; end if;
     perform validate_submission(a);
   elsif not exists(select 1 from service_evidence where service_id=new.id and received_at>=coalesce((select max(created_at) from audit_events where resource_id=new.id and event='service.reject'),'epoch'::timestamptz)) then
     raise exception 'Anexe uma fotografia como evidência da conclusão';
   end if;
 end if;
 return new;
end $$;

create function public.attach_order_checklist(u uuid,c uuid,k text,person uuid,due timestamptz,occ integer,model uuid,label text) returns uuid language plpgsql security definer set search_path=public as $$
declare t checklist_template_versions; a uuid; begin
 select * into t from checklist_template_versions where id=model and unit_id=u;
 if t.id is null or (k='checkin' and t.kind<>'cleaning') or (k='checkout' and t.kind<>'inspection') then raise exception 'Modelo incompatível com a unidade ou tipo de ordem'; end if;
 if not assignee_allowed(u,person,case when k='checkout' then 'inspection' when k='checkin' then 'cleaning' else 'service' end) then raise exception 'Responsável sem função ou acesso à unidade'; end if;
 if jsonb_array_length(applicable_items(t.items,occ))=0 then raise exception 'Modelo sem itens aplicáveis à ocupação'; end if;
 insert into activities(unit_id,cycle_id,kind,title,assignee,due_at,occupancy,template_id,items)
 values(u,c,case when k='checkout' then 'inspection' else 'cleaning' end,label,person,due,occ,t.id,applicable_items(t.items,occ)) returning id into a;
 return a;
end $$;

create function public.create_work_order(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare u units; first_id uuid; second_id uuid; k text; mode text; out_mode text; model uuid; out_model uuid;
 person uuid; out_person uuid; arrival date; departure date; nights integer; guests integer; due timestamptz; out_due timestamptz;
 a uuid; out_a uuid; c uuid; label text; time_out time; existing service_orders;
begin
 select * into u from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 first_id:=coalesce(nullif(payload->>'event_id','')::uuid,gen_random_uuid());
 select * into existing from service_orders where id=first_id;
 if existing.id is not null then
   if existing.unit_id<>u.id then raise exception 'Identificador de ordem já utilizado'; end if;
   return existing.id;
 end if;
 k:=coalesce(payload->>'order_type','general'); mode:=coalesce(payload->>'execution_mode','task');
 if k not in('general','checkin') or mode not in('task','checklist') then raise exception 'Tipo de ordem ou execução inválido'; end if;
 person:=(payload->>'assignee')::uuid;
 if not assignee_allowed(u.id,person,case when k='checkin' then 'cleaning' else 'service' end) then raise exception 'Responsável sem função ou acesso à unidade'; end if;
 if nullif(payload->>'finding_id','') is not null and not exists(select 1 from findings f join activities x on x.id=f.activity_id where f.id=(payload->>'finding_id')::uuid and x.unit_id=u.id) then raise exception 'Ocorrência de outra unidade'; end if;
 if k='checkin' then
   arrival:=(payload->>'checkin')::date; nights:=(payload->>'duration_nights')::integer; guests:=(payload->>'guests')::integer;
   if arrival is null or nights is null or nights not between 1 and 3650 or guests is null or guests not between 1 and u.capacity then raise exception 'Informe a entrada, a duração em diárias e a quantidade de hóspedes'; end if;
   departure:=arrival+nights; time_out:=coalesce(nullif(payload->>'checkout_time','')::time,time '12:00');
   if exists(select 1 from reservations where unit_id=u.id and checkin<departure and checkout>arrival) then raise exception 'Há outra hospedagem neste período'; end if;
   if coalesce(trim(payload->>'guest_name'),'')='' then raise exception 'Informe o nome do hóspede'; end if;
   out_person:=(payload->>'checkout_assignee')::uuid;
   if not assignee_allowed(u.id,out_person,'inspection') then raise exception 'Escolha um responsável pelo checkout com função e acesso'; end if;
   out_mode:=coalesce(payload->>'checkout_execution_mode',mode);
   if out_mode not in('task','checklist') then raise exception 'Execução do checkout inválida'; end if;
   due:=(arrival+coalesce(nullif(payload->>'checkin_time','')::time,time '14:00')) at time zone 'America/Sao_Paulo';
   out_due:=(departure+time_out) at time zone 'America/Sao_Paulo';
   insert into reservations(id,unit_id,guest_name,guests,checkin,checkout,inspector,cleaner,checkout_time)
   values(first_id,u.id,trim(payload->>'guest_name'),guests,arrival,departure,out_person,person,time_out);
   insert into stays(id,unit_id,guest_name,guests,checkin,checkout) values(first_id,u.id,trim(payload->>'guest_name'),guests,arrival,departure);
   insert into preparation_cycles(stay_id,unit_id,occupancy,occupancy_source,reservation_id) values(first_id,u.id,guests,'reservation',first_id) returning id into c;
   label:='Check-in · '||u.name;
 else
   due:=(payload->>'due_at')::timestamptz; guests:=coalesce(nullif(payload->>'occupancy','')::integer,u.base_occupancy); label:=trim(payload->>'title');
   if due is null or coalesce(label,'')='' or guests not between 1 and u.capacity then raise exception 'Informe título, prazo e ocupação válidos'; end if;
 end if;
 if mode='checklist' then
   model:=nullif(payload->>'template_id','')::uuid;
   a:=attach_order_checklist(u.id,c,k,person,due,guests,model,label);
   update activities set priority=coalesce(payload->>'priority','normal') where id=a;
 end if;
 insert into service_orders(id,unit_id,finding_id,title,description,category,priority,assignee,due_at,blocking,created_by,order_type,execution_mode,template_id,activity_id,reservation_id)
 values(first_id,u.id,nullif(payload->>'finding_id','')::uuid,label,coalesce(payload->>'description',''),case when k='checkin' then 'Hospedagem' else 'Serviço' end,coalesce(payload->>'priority','normal'),person,due,coalesce((payload->>'blocking')::boolean,false),auth.uid(),k,mode,model,a,case when k='checkin' then first_id end);
 if k='checkin' then
   second_id:=gen_random_uuid();
   if out_mode='checklist' then
     out_model:=nullif(payload->>'checkout_template_id','')::uuid;
     out_a:=attach_order_checklist(u.id,c,'checkout',out_person,out_due,guests,out_model,'Checkout · '||u.name);
   end if;
   insert into service_orders(id,unit_id,title,description,category,priority,assignee,due_at,created_by,order_type,execution_mode,template_id,activity_id,reservation_id,parent_order_id)
   values(second_id,u.id,'Checkout · '||u.name,'Checkout vinculado à ordem de check-in','Hospedagem','normal',out_person,out_due,auth.uid(),'checkout',out_mode,out_model,out_a,first_id,first_id);
   perform notify(out_person,out_a,'Ordem de checkout programada',u.name||' · '||departure);
   perform notify_agenda(u.id,first_id,'Ordens de check-in e checkout programadas');
 end if;
 if coalesce((payload->>'blocking')::boolean,false) then update units set operational_status='unavailable' where id=u.id; end if;
 perform notify(person,a,'Nova ordem de serviço',label);
 perform audit(u.property_id,first_id,'work_order.created',null,jsonb_build_object('order_type',k,'execution_mode',mode,'template_id',model,'checkout_order_id',second_id,'duration_nights',nights,'guests',guests));
 return first_id;
end $$;

-- Não recalcular check-in com a ocupação de outra hospedagem.
create or replace function public.refresh_scheduled_occupancy(u uuid) returns void language plpgsql security definer set search_path=public as $$
declare a record; target integer; next_occ integer; begin
 for a in select x.id,x.cycle_id,x.occupancy,x.template_id,r.checkout,r.id as reservation_id
 from activities x join preparation_cycles c on c.id=x.cycle_id join reservations r on r.id=c.reservation_id
 where x.unit_id=u and x.kind='cleaning' and x.status='pending' and x.started_at is null
 and not exists(select 1 from service_orders s where s.activity_id=x.id)
 for update of x loop
   select guests into next_occ from reservations where unit_id=u and id<>a.reservation_id and checkin>=a.checkout order by checkin,id limit 1;
   select coalesce(next_occ,base_occupancy) into target from units where id=u;
   update preparation_cycles set occupancy=target,occupancy_source=case when next_occ is null then 'base' else 'reservation' end where id=a.cycle_id;
   if target<>a.occupancy then update activities set occupancy=target,items=applicable_items((select items from checklist_template_versions where id=a.template_id),target),revision=revision+1 where id=a.id; end if;
 end loop;
end $$;

alter function public.reschedule_checkout(uuid,integer,jsonb) rename to reschedule_checkout_legacy;
revoke all on function public.reschedule_checkout_legacy(uuid,integer,jsonb) from public,anon,authenticated;
create function public.reschedule_checkout(reservation uuid,expected_revision integer,payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r reservations; u units; s service_orders; d date; tm time; begin
 select * into r from reservations where id=reservation;
 select * into u from units where id=r.unit_id for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 select * into s from service_orders where reservation_id=r.id and order_type='checkout' for update;
 if s.id is null then perform reschedule_checkout_legacy(reservation,expected_revision,payload); return; end if;
 select * into r from reservations where id=reservation for update;
 if expected_revision is null or r.revision<>expected_revision then raise exception 'A hospedagem foi alterada. Atualize a agenda'; end if;
 if s.status<>'assigned' or exists(select 1 from activities where id=s.activity_id and started_at is not null) then raise exception 'O checkout já foi iniciado; preserve seu histórico'; end if;
 d:=(payload->>'checkout')::date; tm:=coalesce(nullif(payload->>'checkout_time','')::time,r.checkout_time);
 if d is null or d<=r.checkin or length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Informe uma saída válida e justifique a alteração'; end if;
 if exists(select 1 from reservations where unit_id=u.id and id<>r.id and checkin<d and checkout>r.checkin) then raise exception 'A nova saída conflita com outra hospedagem'; end if;
 update reservations set checkout=d,checkout_time=tm,revision=revision+1 where id=r.id;
 update stays set checkout=d where id=r.id;
 update service_orders set due_at=(d+tm) at time zone 'America/Sao_Paulo',revision=revision+1 where id=s.id;
 update activities set due_at=(d+tm) at time zone 'America/Sao_Paulo',revision=revision+1 where id=s.activity_id;
 perform refresh_scheduled_occupancy(u.id);
 perform audit(u.property_id,r.id,'checkout.rescheduled',jsonb_build_object('checkout',r.checkout,'checkout_time',r.checkout_time),payload,payload->>'reason');
 perform notify_agenda(u.id,r.id,'Data do checkout alterada');
end $$;

-- Agenda compartilhada continua sem nomes de hóspedes e sem respostas de execução.
create or replace view public.team_agenda with (security_barrier=true) as
 select r.id,r.unit_id,r.guests,r.checkin,r.checkout,r.checkout_time,r.revision,r.inspector,r.cleaner,c.id as cycle_id,
 coalesce(case so.status when 'assigned' then 'pending' when 'approved' then 'completed' when 'rejected' then 'correction' else so.status end,(select status from activities where cycle_id=c.id and kind='inspection' limit 1)) inspection_status,
 (select status from activities where cycle_id=c.id and kind='cleaning' limit 1) cleaning_status,
 si.id checkin_order_id,so.id checkout_order_id,(r.checkout-r.checkin) duration_nights,si.status checkin_status
 from reservations r left join preparation_cycles c on c.reservation_id=r.id
 left join service_orders si on si.reservation_id=r.id and si.order_type='checkin'
 left join service_orders so on so.reservation_id=r.id and so.order_type='checkout' where can_unit(r.unit_id);

alter function public.activity_action(uuid,integer,text,jsonb) rename to activity_action_agenda;
revoke all on function public.activity_action_agenda(uuid,integer,text,jsonb) from public,anon,authenticated;
create function public.activity_action(activity uuid,expected_revision integer,action text,payload jsonb default '{}') returns integer language plpgsql security definer set search_path=public as $$
declare a activities; s service_orders; result integer; p uuid; before_value jsonb; previous_status text; begin
 select * into a from activities where id=activity;
 perform 1 from units where id=a.unit_id for update;
 select * into s from service_orders where activity_id=activity for update;
 if s.id is null then return activity_action_agenda(activity,expected_revision,action,payload); end if;
 select * into a from activities where id=activity for update;
 select operational_status into previous_status from units where id=a.unit_id;
 if not coalesce(can_activity(activity),false) then raise exception 'Acesso negado'; end if;
 if expected_revision is null or a.revision<>expected_revision then raise exception 'CONFLICT: ordem alterada; recarregue'; end if;
 if action='start' and s.order_type in('checkin','checkout') and (a.due_at at time zone 'America/Sao_Paulo')::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Esta ordem está programada para uma data futura'; end if;
 if s.order_type in('checkin','checkout') and action in('schedule','cancel') then raise exception 'Altere a hospedagem pela agenda da equipe'; end if;
 if action='schedule' then
   if not can_unit(a.unit_id,true) or a.status not in('pending','in_progress','correction') or length(trim(coalesce(payload->>'reason','')))<5 or not assignee_allowed(a.unit_id,(payload->>'assignee')::uuid,'service') or (payload->>'due_at')::timestamptz is null then raise exception 'Programação não permitida ou responsável inválido'; end if;
   before_value:=to_jsonb(a);
   update activities set assignee=(payload->>'assignee')::uuid,due_at=(payload->>'due_at')::timestamptz,priority=coalesce(payload->>'priority','normal'),revision=revision+1 where id=a.id returning revision into result;
   select property_id into p from units where id=a.unit_id;
   perform audit(p,a.id,'activity.schedule',before_value,(select to_jsonb(x) from activities x where id=a.id),payload->>'reason');
   perform notify(a.assignee,a.id,'Programação da ordem alterada',payload->>'reason');
   if a.assignee<>(payload->>'assignee')::uuid then perform notify((payload->>'assignee')::uuid,a.id,'Ordem atribuída',a.title); end if;
 elsif action='submit' then
   if a.assignee<>auth.uid() or a.status not in('in_progress','correction') then raise exception 'Inicie a ordem e envie como responsável'; end if;
   perform validate_submission(a);
   before_value:=to_jsonb(a);
   insert into checklist_review_cycles(activity_id,attempt,executor,snapshot) values(a.id,a.attempt,auth.uid(),before_value);
   update activities set status='review',submitted_at=now(),revision=revision+1 where id=a.id returning revision into result;
   if s.order_type='checkin' then update units set operational_status='review' where id=a.unit_id; end if;
   select property_id into p from units where id=a.unit_id;
   perform audit(p,a.id,'activity.submit',before_value,(select to_jsonb(x) from activities x where id=a.id));
   perform notify_managers(a.unit_id,a.id,'Ordem de serviço aguardando revisão',a.title);
 elsif action='approve' then
   if not can_unit(a.unit_id,true) or a.assignee=auth.uid() or exists(select 1 from audit_events where resource_id=a.id and actor=auth.uid() and event in('activity.start','activity.save','activity.submit')) then raise exception 'Autoaprovação proibida ou gestor não autorizado'; end if;
   if a.status<>'review' then raise exception 'A ordem não aguarda revisão'; end if;
   perform validate_submission(a);
   if s.order_type='checkin' and (exists(select 1 from findings f join activities x on x.id=f.activity_id where x.unit_id=a.unit_id and f.blocking and f.resolved_at is null) or exists(select 1 from service_orders where unit_id=a.unit_id and blocking and id<>s.id and status not in('approved','cancelled'))) then raise exception 'Existem pendências impeditivas'; end if;
   before_value:=to_jsonb(a);
   update activities set status='completed',approved_at=now(),approved_by=auth.uid(),revision=revision+1 where id=a.id returning revision into result;
   update checklist_review_cycles set reviewer=auth.uid(),decision='approved',reviewed_at=now() where activity_id=a.id and attempt=a.attempt;
   select property_id into p from units where id=a.unit_id;
   perform audit(p,a.id,'activity.approve',before_value,(select to_jsonb(x) from activities x where id=a.id));
   perform notify(a.assignee,a.id,'Ordem de serviço aprovada',a.title);
 else
   result:=activity_action_legacy(activity,expected_revision,action,payload);
 end if;
 select * into a from activities where id=activity;
 update service_orders set status=case a.status when 'pending' then 'assigned' when 'correction' then 'rejected' when 'completed' then 'approved' else a.status end,assignee=a.assignee,due_at=a.due_at,priority=a.priority,revision=revision+1,reviewer=a.approved_by where id=s.id;
 if s.order_type='checkin' and action='start' then update units set operational_status='preparing' where id=a.unit_id; end if;
 if s.order_type='checkin' and action='approve' then update units set operational_status='ready',prepared_for=a.occupancy where id=a.unit_id; end if;
 if s.order_type='checkout' and action in('start','approve') then update units set operational_status='unavailable',prepared_for=null where id=a.unit_id; end if;
 if s.order_type='general' then update units set operational_status=case when s.blocking then 'unavailable' else previous_status end where id=a.unit_id; end if;
 if s.reservation_id is not null then insert into agenda_changes(unit_id,reservation_id) values(a.unit_id,s.reservation_id); end if;
 return result;
end $$;

alter function public.service_action(text,jsonb) rename to service_action_legacy;
revoke all on function public.service_action_legacy(text,jsonb) from public,anon,authenticated;
create function public.service_action(action text,payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare s service_orders; r reservations; result uuid; u uuid; begin
 if action='create' then return create_work_order(payload); end if;
 select unit_id into u from service_orders where id=(payload->>'id')::uuid;
 perform 1 from units where id=u for update;
 select * into s from service_orders where id=(payload->>'id')::uuid for update;
 if s.id is null or not coalesce(can_unit(s.unit_id),false) or (s.assignee<>auth.uid() and not can_unit(s.unit_id,true)) then raise exception 'Acesso negado'; end if;
 if (payload->>'revision')::integer is null or s.revision<>(payload->>'revision')::integer then raise exception 'CONFLICT: ordem alterada'; end if;
 if s.activity_id is not null then raise exception 'Execute esta ordem pelo checklist'; end if;
 if action='start' and s.order_type in('checkin','checkout') and (s.due_at at time zone 'America/Sao_Paulo')::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Esta ordem está programada para uma data futura'; end if;
 if action='approve' and s.order_type='checkin' and (exists(select 1 from service_orders where unit_id=s.unit_id and blocking and id<>s.id and status not in('approved','cancelled')) or exists(select 1 from findings f join activities a on a.id=f.activity_id where a.unit_id=s.unit_id and f.blocking and f.resolved_at is null)) then raise exception 'Existem pendências impeditivas'; end if;
 result:=service_action_legacy(action,payload);
 if s.order_type='checkin' and action='start' then update units set operational_status='preparing' where id=s.unit_id; end if;
 if s.order_type='checkin' and action='approve' then
   select * into r from reservations where id=s.reservation_id;
   update units set operational_status='ready',prepared_for=r.guests where id=s.unit_id;
 end if;
 if s.order_type='checkout' and action in('start','approve') then update units set operational_status='unavailable',prepared_for=null where id=s.unit_id; end if;
 if s.reservation_id is not null then insert into agenda_changes(unit_id,reservation_id) values(s.unit_id,s.reservation_id); end if;
 return result;
end $$;

revoke all on function public.attach_order_checklist(uuid,uuid,text,uuid,timestamptz,integer,uuid,text),public.create_work_order(jsonb),public.activity_action(uuid,integer,text,jsonb),public.service_action(text,jsonb),public.reschedule_checkout(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.create_work_order(jsonb),public.activity_action(uuid,integer,text,jsonb),public.service_action(text,jsonb),public.reschedule_checkout(uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
