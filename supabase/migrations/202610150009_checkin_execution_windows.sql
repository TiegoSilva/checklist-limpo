-- Janelas de execução e checkout derivado do modelo escolhido no check-in.
alter table public.service_orders add column scheduled_start_at timestamptz,
 add column checkin_order_id uuid references public.service_orders;
alter table public.reservations add column checkout_start_time time;
update public.reservations set checkout_start_time=checkout_time;
update public.service_orders set scheduled_start_at=due_at where order_type in('checkin','checkout');
update public.service_orders set checkin_order_id=case when order_type='checkin' then id else parent_order_id end where order_type in('checkin','checkout');
alter table public.service_orders add constraint service_time_window check(scheduled_start_at is null or scheduled_start_at<=due_at);
create index service_checkin_origin on public.service_orders(checkin_order_id);

create function public.checkout_items(items jsonb) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(item order by ord),'[]'::jsonb) from jsonb_array_elements(items) with ordinality as x(item,ord) where item->>'mode'='count';
$$;
revoke all on function public.checkout_items(jsonb) from public,anon,authenticated;

create or replace function public.create_work_order(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare u units; first_id uuid; second_id uuid; k text; mode text; out_mode text; model uuid; out_model uuid;
 person uuid; out_person uuid; arrival date; departure date; nights integer; guests integer; due timestamptz; out_due timestamptz;
 a uuid; out_a uuid; c uuid; label text; time_out time; time_in_start time; time_out_start time; time_in_end time; origin service_orders; existing service_orders;
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
   departure:=arrival+nights; time_out:=coalesce(nullif(payload->>'checkout_time','')::time,time '12:30');
   if exists(select 1 from reservations where unit_id=u.id and checkin<departure and checkout>arrival) then raise exception 'Há outra hospedagem neste período'; end if;
   if coalesce(trim(payload->>'guest_name'),'')='' then raise exception 'Informe o nome do hóspede'; end if;
   out_person:=(payload->>'checkout_assignee')::uuid;
   if not assignee_allowed(u.id,out_person,'inspection') then raise exception 'Escolha um responsável pelo checkout com função e acesso'; end if;
   out_mode:=mode;
   time_in_start:=coalesce(nullif(payload->>'checkin_start_time','')::time,time '13:30');
   time_in_end:=coalesce(nullif(payload->>'checkin_time','')::time,time '15:00');
   time_out_start:=coalesce(nullif(payload->>'checkout_start_time','')::time,time '11:30');
   if time_in_start>=time_in_end or time_out_start>=time_out then raise exception 'O fim deve ser depois do início'; end if;
   if out_mode not in('task','checklist') then raise exception 'Execução do checkout inválida'; end if;
   due:=(arrival+time_in_end) at time zone 'America/Sao_Paulo';
   out_due:=(departure+time_out) at time zone 'America/Sao_Paulo';
   insert into reservations(id,unit_id,guest_name,guests,checkin,checkout,inspector,cleaner,checkout_time,checkout_start_time)
   values(first_id,u.id,trim(payload->>'guest_name'),guests,arrival,departure,out_person,person,time_out,time_out_start);
   insert into stays(id,unit_id,guest_name,guests,checkin,checkout) values(first_id,u.id,trim(payload->>'guest_name'),guests,arrival,departure);
   insert into preparation_cycles(stay_id,unit_id,occupancy,occupancy_source,reservation_id) values(first_id,u.id,guests,'reservation',first_id) returning id into c;
   label:='Check-in · '||u.name;
 else
   due:=(payload->>'due_at')::timestamptz; guests:=coalesce(nullif(payload->>'occupancy','')::integer,u.base_occupancy); label:=trim(payload->>'title');
   if due is null or coalesce(label,'')='' or guests not between 1 and u.capacity then raise exception 'Informe título, prazo e ocupação válidos'; end if;
 end if;
 if k='general' and nullif(payload->>'checkin_order_id','') is not null then
   select * into origin from service_orders where id=(payload->>'checkin_order_id')::uuid and unit_id=u.id and order_type='checkin' and status<>'cancelled';
   if origin.id is null then raise exception 'Check-in de origem incompatível com a unidade'; end if;
 end if;
 if mode='checklist' then
   model:=nullif(payload->>'template_id','')::uuid;
   a:=attach_order_checklist(u.id,c,k,person,due,guests,model,label);
   update activities set priority=coalesce(payload->>'priority','normal') where id=a;
 end if;
 insert into service_orders(id,unit_id,finding_id,title,description,category,priority,assignee,due_at,blocking,created_by,order_type,execution_mode,template_id,activity_id,reservation_id,checkin_order_id,scheduled_start_at)
 values(first_id,u.id,nullif(payload->>'finding_id','')::uuid,label,coalesce(payload->>'description',''),case when k='checkin' then 'Hospedagem' else 'Serviço' end,coalesce(payload->>'priority','normal'),person,due,coalesce((payload->>'blocking')::boolean,false),auth.uid(),k,mode,model,a,case when k='checkin' then first_id else origin.reservation_id end,case when k='checkin' then first_id else origin.id end,case when k='checkin' then (arrival+time_in_start) at time zone 'America/Sao_Paulo' end);
 if k='checkin' then
   second_id:=gen_random_uuid();
   if out_mode='checklist' then
     out_model:=model;
     if jsonb_array_length(applicable_items(checkout_items((select items from checklist_template_versions where id=model)),guests))=0 then
       out_mode:='task'; out_model:=null;
     else
       insert into activities(unit_id,cycle_id,kind,title,assignee,due_at,occupancy,template_id,items)
       values(u.id,c,'inspection','Checkout · '||u.name,out_person,out_due,guests,out_model,applicable_items(checkout_items((select items from checklist_template_versions where id=model)),guests)) returning id into out_a;
     end if;
   end if;
   insert into service_orders(id,unit_id,title,description,category,priority,assignee,due_at,created_by,order_type,execution_mode,template_id,activity_id,reservation_id,parent_order_id,checkin_order_id,scheduled_start_at)
   values(second_id,u.id,'Checkout · '||u.name,'Checkout vinculado à ordem de check-in','Hospedagem','normal',out_person,out_due,auth.uid(),'checkout',out_mode,out_model,out_a,first_id,first_id,first_id,(departure+time_out_start) at time zone 'America/Sao_Paulo');
   perform notify(out_person,out_a,'Ordem de checkout programada',u.name||' · '||departure);
   perform notify_agenda(u.id,first_id,'Ordens de check-in e checkout programadas');
 end if;
 if coalesce((payload->>'blocking')::boolean,false) then update units set operational_status='unavailable' where id=u.id; end if;
 perform notify(person,a,'Nova ordem de serviço',label);
 perform audit(u.property_id,first_id,'work_order.created',null,jsonb_build_object('order_type',k,'execution_mode',mode,'template_id',model,'checkout_order_id',second_id,'duration_nights',nights,'guests',guests));
 return first_id;
end $$;

create or replace function public.reschedule_checkout(reservation uuid,expected_revision integer,payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r reservations; u units; s service_orders; d date; tm time; start_tm time; begin
 select * into r from reservations where id=reservation;
 select * into u from units where id=r.unit_id for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 select * into s from service_orders where reservation_id=r.id and order_type='checkout' for update;
 if s.id is null then
   if nullif(payload->>'checkout_start_time','') is not null then
     start_tm:=(payload->>'checkout_start_time')::time;
     tm:=coalesce(nullif(payload->>'checkout_time','')::time,r.checkout_time);
     if start_tm>=tm then raise exception 'O fim deve ser depois do início'; end if;
   end if;
   perform reschedule_checkout_legacy(reservation,expected_revision,payload);
   if start_tm is not null then update reservations set checkout_start_time=start_tm where id=reservation; end if;
   return;
 end if;
 select * into r from reservations where id=reservation for update;
 if expected_revision is null or r.revision<>expected_revision then raise exception 'A hospedagem foi alterada. Atualize a agenda'; end if;
 if s.status not in('assigned','in_progress','rejected') then raise exception 'O checkout já foi iniciado ou enviado para revisão; preserve seu histórico'; end if;
 d:=(payload->>'checkout')::date; tm:=coalesce(nullif(payload->>'checkout_time','')::time,r.checkout_time);
 start_tm:=coalesce(nullif(payload->>'checkout_start_time','')::time,r.checkout_start_time);
 if nullif(payload->>'checkout_start_time','') is null and start_tm>tm then start_tm:=tm; end if;
 if start_tm>tm or (nullif(payload->>'checkout_start_time','') is not null and start_tm=tm) then raise exception 'O fim deve ser depois do início'; end if;
 if s.status<>'assigned' and (d<>r.checkout or d<>(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'O checkout já foi iniciado: ajuste somente o horário no dia da execução'; end if;
 if d is null or d<=r.checkin or length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Informe uma saída válida e justifique a alteração'; end if;
 if exists(select 1 from reservations where unit_id=u.id and id<>r.id and checkin<d and checkout>r.checkin) then raise exception 'A nova saída conflita com outra hospedagem'; end if;
 update reservations set checkout=d,checkout_time=tm,checkout_start_time=start_tm,revision=revision+1 where id=r.id;
 update stays set checkout=d where id=r.id;
 update service_orders set due_at=(d+tm) at time zone 'America/Sao_Paulo',scheduled_start_at=(d+start_tm) at time zone 'America/Sao_Paulo',revision=revision+1 where id=s.id;
 update activities set due_at=(d+tm) at time zone 'America/Sao_Paulo',revision=revision+1 where id=s.activity_id;
 perform refresh_scheduled_occupancy(u.id);
 perform audit(u.property_id,r.id,'checkout.rescheduled',jsonb_build_object('checkout',r.checkout,'checkout_time',r.checkout_time,'checkout_start_time',r.checkout_start_time),payload,payload->>'reason');
 perform notify_agenda(u.id,r.id,'Data do checkout alterada');
end $$;

create or replace view public.team_agenda with (security_barrier=true) as
 select r.id,r.unit_id,r.guests,r.checkin,r.checkout,r.checkout_time,r.revision,r.inspector,r.cleaner,c.id as cycle_id,
 coalesce(case so.status when 'assigned' then 'pending' when 'approved' then 'completed' when 'rejected' then 'correction' else so.status end,(select status from activities where cycle_id=c.id and kind='inspection' limit 1)) inspection_status,
 (select status from activities where cycle_id=c.id and kind='cleaning' limit 1) cleaning_status,
 si.id checkin_order_id,so.id checkout_order_id,(r.checkout-r.checkin) duration_nights,si.status checkin_status,r.checkout_start_time,
 (si.scheduled_start_at at time zone 'America/Sao_Paulo')::time checkin_start_time,
 (si.due_at at time zone 'America/Sao_Paulo')::time checkin_end_time
 from reservations r left join preparation_cycles c on c.reservation_id=r.id
 left join service_orders si on si.reservation_id=r.id and si.order_type='checkin'
 left join service_orders so on so.reservation_id=r.id and so.order_type='checkout' where can_unit(r.unit_id);


notify pgrst,'reload schema';

-- Entradas explícitas permitem ao frontend detectar uma migração pendente.
create function public.create_scheduled_work_order(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
begin return create_work_order(payload); end $$;
create function public.reschedule_checkout_window(reservation uuid,expected_revision integer,payload jsonb) returns void language plpgsql security definer set search_path=public as $$
begin perform reschedule_checkout(reservation,expected_revision,payload); end $$;
revoke all on function public.create_scheduled_work_order(jsonb),public.reschedule_checkout_window(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.create_scheduled_work_order(jsonb),public.reschedule_checkout_window(uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
