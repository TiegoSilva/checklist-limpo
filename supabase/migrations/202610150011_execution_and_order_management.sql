-- Execução simplificada, fotos gerais e exclusão recuperável de ordens.
alter table public.activities add column execution_version integer not null default 1,
 add column last_submission_id uuid, add column manager_reopened boolean not null default false,
 add column deleted_at timestamptz;
alter table public.service_orders add column deleted_at timestamptz,
 add column deleted_by uuid references public.profiles, add column deleted_batch_id uuid;
alter table public.reservations add column cancelled_at timestamptz;

create or replace function public.register_evidence(activity uuid,item text,file_id uuid,hash text) returns void language plpgsql security definer set search_path=public as $$
declare a activities; path text; p uuid; begin
 select * into a from activities where id=activity for update;
 if a.deleted_at is not null or not coalesce(can_activity(activity),false) or a.assignee<>auth.uid() or a.status not in('in_progress','correction') then raise exception 'Evidência não permitida'; end if;
 if item<>'__activity__' and not exists(select 1 from jsonb_array_elements(a.items) i where i->>'id'=item) then raise exception 'Item inválido'; end if;
 if exists(select 1 from evidence_files where id=file_id and activity_id=activity and uploader=auth.uid()) then return; end if;
 if item='__activity__' and (select count(*) from evidence_files where activity_id=activity and attempt=a.attempt and item_id='__activity__')>=8 then raise exception 'Limite de 8 fotos por envio'; end if;
 path:=activity::text||'/'||file_id::text;
 if not exists(select 1 from storage.objects where bucket_id='evidence' and name=path) then raise exception 'Envie primeiro o arquivo'; end if;
 insert into evidence_files(id,activity_id,item_id,attempt,uploader,path,sha256) values(file_id,activity,item,a.attempt,auth.uid(),path,hash);
 select property_id into p from units where id=a.unit_id;
 perform audit(p,activity,'evidence.received',null,jsonb_build_object('file_id',file_id,'item',item,'sha256',hash));
end $$;

alter function public.validate_submission(public.activities) rename to validate_submission_before_general_photos;
revoke all on function public.validate_submission_before_general_photos(public.activities) from public,anon,authenticated;
create function public.validate_submission(a public.activities) returns void language plpgsql security definer set search_path=public as $$
declare i jsonb; r jsonb; begin
 if a.execution_version=1 then perform validate_submission_before_general_photos(a); return; end if;
 for i in select value from jsonb_array_elements(a.items) loop
   r:=a.responses->(i->>'id');
   if coalesce((i->>'required')::boolean,true) and not coalesce((r->>'confirmed')::boolean,false) then raise exception 'Confira o item: %',i->>'title'; end if;
   if not coalesce((r->>'confirmed')::boolean,false) then continue; end if;
   -- Respostas históricas não devolvidas para correção continuam imutáveis.
   if a.attempt>1 and exists(select 1 from checklist_review_cycles rc where rc.activity_id=a.id and rc.attempt=a.attempt-1 and not((i->>'id')=any(rc.rejected_items)) and r is not distinct from rc.snapshot->'responses'->(i->>'id')) then continue; end if;
   if i->>'mode'='count' then
     if coalesce(r->>'found','') !~ '^[0-9]{1,4}$' or coalesce(r->>'condition','') not in('ok','damaged','divergent') then raise exception 'Quantidade ou condição inválida: %',i->>'title'; end if;
     if ((r->>'found')::integer<>(i->>'expected')::integer) is distinct from (r->>'condition'='divergent') then raise exception 'A condição deve acompanhar a quantidade: %',i->>'title'; end if;
   end if;
   if i->>'mode'='technical' and (coalesce(r->>'answer','') not in('ok','issue','na') or (r->>'answer'='na' and not coalesce((i->>'allow_na')::boolean,false))) then raise exception 'Resposta técnica inválida: %',i->>'title'; end if;
   if ((i->>'mode'='count' and r->>'condition'<>'ok') or r->>'answer'='issue') and length(trim(coalesce(r->>'note','')))<5 then raise exception 'Descreva a divergência em pelo menos 5 caracteres: %',i->>'title'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(a.items) entry where coalesce((entry->>'evidence_required')::boolean,false)) and not exists(select 1 from evidence_files e where e.activity_id=a.id and (a.attempt=1 or e.attempt=a.attempt)) then raise exception 'Adicione ao menos uma foto no campo Fotos da vistoria'; end if;
 if (select count(*) from evidence_files where activity_id=a.id and attempt=a.attempt and item_id='__activity__')>8 then raise exception 'Limite de 8 fotos por envio'; end if;
end $$;
revoke all on function public.validate_submission(public.activities) from public,anon,authenticated;

create function public.submit_checklist(activity uuid,expected_revision integer,submission uuid,responses jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare a activities; s service_orders; p uuid; i jsonb; r jsonb; normalized jsonb; item_id text; begin
 select * into a from activities where id=activity;
 perform 1 from units where id=a.unit_id for update;
 select * into s from service_orders where activity_id=activity for update;
 select * into a from activities where id=activity for update;
 if a.id is null or a.deleted_at is not null or a.assignee<>auth.uid() or not coalesce(can_activity(activity),false) then raise exception 'Acesso negado'; end if;
 if submission is null then raise exception 'Identificador de envio obrigatório'; end if;
 if a.last_submission_id=submission and a.status in('review','completed') then return a.revision; end if;
 if expected_revision is null or a.revision<>expected_revision then raise exception 'CONFLICT: a vistoria mudou no servidor. Seu rascunho foi preservado; atualize antes de reenviar'; end if;
 if a.status not in('in_progress','correction') then raise exception 'Inicie ou retome a vistoria antes de enviar'; end if;
 if jsonb_typeof(responses) is distinct from 'object' then raise exception 'Respostas inválidas'; end if;
 if exists(select 1 from jsonb_object_keys(responses) k where not exists(select 1 from jsonb_array_elements(a.items) entry where entry->>'id'=k)) then raise exception 'Item desconhecido'; end if;
 normalized:=responses;
 for i in select value from jsonb_array_elements(a.items) loop
   item_id:=i->>'id'; r:=normalized->item_id;
   if not a.manager_reopened and a.attempt>1 and exists(select 1 from checklist_review_cycles rc where rc.activity_id=a.id and rc.attempt=a.attempt-1 and not(item_id=any(rc.rejected_items))) then
     if r is distinct from a.responses->item_id then raise exception 'Altere somente os itens devolvidos para correção'; end if;
     continue;
   end if;
   r:=coalesce(r,'{}'::jsonb)||jsonb_build_object('confirmed',coalesce((r->>'confirmed')::boolean,false));
   if i->>'mode'='count' then
     r:=r||jsonb_build_object('found',coalesce((r->>'found')::integer,(i->>'expected')::integer,0));
     r:=r||jsonb_build_object('condition',case when (r->>'found')::integer<>(i->>'expected')::integer then 'divergent' when r->>'condition' in('damaged','broken') then 'damaged' else 'ok' end);
   elsif i->>'mode'='technical' then r:=r||jsonb_build_object('answer',coalesce(r->>'answer','ok')); end if;
   normalized:=jsonb_set(normalized,array[item_id],r);
 end loop;
 select property_id into p from units where id=a.unit_id;
 -- Respostas, snapshot e status são confirmados na mesma transação.
 update activities set responses=normalized,execution_version=2 where id=a.id returning * into a;
 perform validate_submission(a);
 perform audit(p,a.id,'activity.save',null,jsonb_build_object('submission_id',submission));
 insert into checklist_review_cycles(activity_id,attempt,executor,snapshot) values(a.id,a.attempt,auth.uid(),to_jsonb(a));
 update activities set status='review',submitted_at=now(),revision=revision+1,last_submission_id=submission,manager_reopened=false where id=a.id returning revision into expected_revision;
 if s.id is not null then update service_orders set status='review',revision=revision+1 where id=s.id; end if;
 if s.order_type='checkin' or (s.id is null and a.kind<>'inspection') then update units set operational_status='review' where id=a.unit_id; end if;
 perform audit(p,a.id,'activity.submit',null,jsonb_build_object('submission_id',submission,'responses',normalized));
 perform notify_managers(a.unit_id,a.id,'Vistoria aguardando aprovação',a.title);
 if s.reservation_id is not null then insert into agenda_changes(unit_id,reservation_id) values(a.unit_id,s.reservation_id); end if;
 return expected_revision;
end $$;
revoke all on function public.submit_checklist(uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_checklist(uuid,integer,uuid,jsonb) to authenticated;

-- Bloqueia execução de ordens excluídas, preservando APIs antigas para o histórico.
alter function public.activity_action(uuid,integer,text,jsonb) rename to activity_action_before_management;
revoke all on function public.activity_action_before_management(uuid,integer,text,jsonb) from public,anon,authenticated;
create function public.activity_action(activity uuid,expected_revision integer,action text,payload jsonb default '{}') returns integer language plpgsql security definer set search_path=public as $$
declare a activities; p uuid; result integer; begin
 select * into a from activities where id=activity;
 if a.deleted_at is not null then raise exception 'Esta ordem foi excluída'; end if;
 if action='approve' and a.execution_version=2 and not exists(select 1 from service_orders where activity_id=a.id) then
   perform 1 from units where id=a.unit_id for update;
   select * into a from activities where id=activity for update;
   if not coalesce(can_unit(a.unit_id,true),false) or a.assignee=auth.uid() or exists(select 1 from audit_events where resource_id=a.id and actor=auth.uid() and event in('activity.start','activity.save','activity.submit')) then raise exception 'Autoaprovação proibida ou gestor não autorizado'; end if;
   if expected_revision is null or a.revision<>expected_revision or a.status<>'review' then raise exception 'CONFLICT: atualize a vistoria'; end if;
   perform validate_submission(a);
   if a.kind<>'inspection' and exists(select 1 from activities where cycle_id=a.cycle_id and kind='inspection' and status not in('completed','cancelled') and deleted_at is null) then raise exception 'Conclua a vistoria de checkout antes da liberação'; end if;
   if a.kind<>'inspection' and (exists(select 1 from findings f join activities x on x.id=f.activity_id where x.unit_id=a.unit_id and f.blocking and f.resolved_at is null) or exists(select 1 from service_orders where unit_id=a.unit_id and blocking and status not in('approved','cancelled') and deleted_at is null)) then raise exception 'Existem pendências impeditivas'; end if;
   update activities set status='completed',approved_at=now(),approved_by=auth.uid(),revision=revision+1 where id=a.id returning revision into result;
   update checklist_review_cycles set reviewer=auth.uid(),decision='approved',reviewed_at=now() where activity_id=a.id and attempt=a.attempt;
   update units set operational_status=case when a.kind='inspection' then 'unavailable' else 'ready' end,prepared_for=case when a.kind<>'inspection' then a.occupancy end where id=a.unit_id;
   select property_id into p from units where id=a.unit_id;
   perform audit(p,a.id,'activity.approve',to_jsonb(a),jsonb_build_object('status','completed'));
   perform notify(a.assignee,a.id,'Vistoria aprovada',a.title);
   return result;
 end if;
 result:=activity_action_before_management(activity,expected_revision,action,payload);
 if action='reject' then update activities set manager_reopened=false where id=activity; end if;
 return result;
end $$;
revoke all on function public.activity_action(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.activity_action(uuid,integer,text,jsonb) to authenticated;

alter function public.service_action(text,jsonb) rename to service_action_before_management;
revoke all on function public.service_action_before_management(text,jsonb) from public,anon,authenticated;
create function public.service_action(action text,payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
begin
 if action<>'create' and exists(select 1 from service_orders where id=(payload->>'id')::uuid and deleted_at is not null) then raise exception 'Esta ordem foi excluída'; end if;
 return service_action_before_management(action,payload);
end $$;
revoke all on function public.service_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_action(text,jsonb) to authenticated;

create function public.manage_work_order(order_id uuid,expected_revision integer,action text,payload jsonb default '{}') returns void language plpgsql security definer set search_path=public as $$
declare s service_orders; current_order service_orders; a activities; target text; why text; ids uuid[]; batch uuid; r reservations; item_ids text[]; reopen boolean; begin
 select * into s from service_orders where id=order_id;
 perform 1 from units where id=s.unit_id for update;
 select * into s from service_orders where id=order_id for update;
 if s.id is null or not coalesce(can_unit(s.unit_id,true),false) then raise exception 'Acesso negado: somente administrador ou gestor da unidade'; end if;
 if expected_revision is null or s.revision<>expected_revision then raise exception 'CONFLICT: a ordem mudou. Atualize antes de continuar'; end if;
 why:=trim(coalesce(payload->>'reason',''));
 if length(why)<5 then raise exception 'Informe o motivo, com pelo menos 5 caracteres'; end if;
 if action in('delete','restore') then
   if action='delete' then
     if s.deleted_at is not null then raise exception 'A ordem já foi excluída'; end if;
     batch:=gen_random_uuid();
     select array_agg(id) into ids from service_orders where deleted_at is null and (id=s.id or (s.order_type='checkin' and parent_order_id=s.id));
   else
     if s.deleted_at is null then raise exception 'Esta ordem não está excluída'; end if;
     select array_agg(id) into ids from service_orders where unit_id=s.unit_id and deleted_at is not null and (id=s.id or (s.deleted_batch_id is not null and deleted_batch_id=s.deleted_batch_id));
     select * into r from reservations where id=s.reservation_id;
     if r.id is not null and r.cancelled_at is not null and exists(select 1 from reservations other where other.unit_id=r.unit_id and other.id<>r.id and other.cancelled_at is null and other.checkin<r.checkout and other.checkout>r.checkin) then raise exception 'Não é possível restaurar: as datas conflitam com outra hospedagem'; end if;
   end if;
   for current_order in select * from service_orders where id=any(ids) order by id for update loop
     select * into a from activities where id=current_order.activity_id for update;
     if a.id is not null then
       if action='delete' and a.status='review' then
         update checklist_review_cycles set decision='rejected',reviewer=auth.uid(),reviewed_at=now(),reason=why,rejected_items=array(select value->>'id' from jsonb_array_elements(a.items)) where activity_id=a.id and attempt=a.attempt and decision is null;
       end if;
       update activities set deleted_at=case when action='delete' then now() end,status=case when action='delete' then 'cancelled' else 'pending' end,
         revision=revision+1,attempt=attempt+case when action='restore' then 1 else 0 end,manager_reopened=action='restore',
         approved_at=case when action='delete' then approved_at end,approved_by=case when action='delete' then approved_by end,
         submitted_at=case when action='delete' then submitted_at end,started_at=case when action='delete' then started_at end
         where id=a.id;
     end if;
     update service_orders set deleted_at=case when action='delete' then now() end,deleted_by=case when action='delete' then auth.uid() end,
       deleted_batch_id=case when action='delete' then batch end,status=case when action='delete' then 'cancelled' else 'assigned' end,reviewer=case when action='delete' then reviewer end,revision=revision+1 where id=current_order.id;
     perform audit((select property_id from units where id=s.unit_id),current_order.id,'work_order.'||action,to_jsonb(current_order),jsonb_build_object('batch',batch,'status',case when action='delete' then 'cancelled' else 'assigned' end),why);
     perform notify(current_order.assignee,null,case when action='delete' then 'Ordem excluída' else 'Ordem restaurada' end,current_order.title);
   end loop;
   if exists(select 1 from service_orders where id=any(ids) and order_type='checkin') then update reservations set cancelled_at=case when action='delete' then now() end,revision=revision+1 where id=s.reservation_id; end if;
   if action='delete' and s.order_type in('checkin','checkout') and s.status in('in_progress','review','approved','rejected') then update units set operational_status='unavailable',prepared_for=null where id=s.unit_id; end if;
 elsif action='status' then
   if s.deleted_at is not null then raise exception 'Restaure a ordem antes de mudar seu status'; end if;
   target:=payload->>'status';
   if target is null or target not in('assigned','in_progress','review','approved','rejected','cancelled') then raise exception 'Status inválido'; end if;
   if target=s.status then return; end if;
   select * into a from activities where id=s.activity_id for update;
   if target='approved' and (s.assignee=auth.uid() or exists(select 1 from audit_events where actor=auth.uid() and resource_id=a.id and event in('activity.start','activity.save','activity.submit'))) then raise exception 'Autoaprovação proibida: outro gestor deve aprovar'; end if;
   if target in('review','approved') then
     if a.id is not null then perform validate_submission(a);
     elsif length(trim(coalesce(s.completion_note,'')))<5 or not exists(select 1 from service_evidence where service_id=s.id and received_at>=coalesce((select max(created_at) from audit_events where resource_id=s.id and event='service.reject'),'epoch'::timestamptz)) then raise exception 'Registre a conclusão e a foto da tarefa antes de enviar para aprovação'; end if;
   end if;
   if target='approved' and s.order_type='checkin' and (exists(select 1 from findings f join activities x on x.id=f.activity_id where x.unit_id=s.unit_id and f.blocking and f.resolved_at is null) or exists(select 1 from service_orders where unit_id=s.unit_id and id<>s.id and blocking and status not in('approved','cancelled') and deleted_at is null)) then raise exception 'Existem pendências impeditivas'; end if;
   if a.id is not null then
     item_ids:=array(select value->>'id' from jsonb_array_elements(a.items));
     reopen:=target in('assigned','in_progress','rejected') and a.status in('review','completed','cancelled');
     if a.status='review' and target not in('review','approved') then update checklist_review_cycles set decision='rejected',reviewer=auth.uid(),reason=why,rejected_items=item_ids,reviewed_at=now() where activity_id=a.id and attempt=a.attempt and decision is null; end if;
     if target in('review','approved') then
       insert into checklist_review_cycles(activity_id,attempt,executor,snapshot) values(a.id,a.attempt,a.assignee,to_jsonb(a)) on conflict(activity_id,attempt) do nothing;
       if target='approved' then update checklist_review_cycles set decision='approved',reviewer=auth.uid(),reason=why,reviewed_at=now() where activity_id=a.id and attempt=a.attempt; end if;
     end if;
     update activities set status=case target when 'assigned' then 'pending' when 'rejected' then 'correction' when 'approved' then 'completed' else target end,
       attempt=attempt+case when reopen then 1 else 0 end,manager_reopened=manager_reopened or reopen,
       started_at=case when target in('in_progress','rejected') then coalesce(started_at,now()) when target='assigned' then null else started_at end,
       submitted_at=case when target in('review','approved') then coalesce(submitted_at,now()) end,
       approved_at=case when target='approved' then now() end,approved_by=case when target='approved' then auth.uid() end,revision=revision+1 where id=a.id;
   end if;
   update service_orders set status=target,reviewer=case when target='approved' then auth.uid() end,revision=revision+1 where id=s.id;
   if s.order_type='checkin' then update units set operational_status=case target when 'approved' then 'ready' when 'in_progress' then 'preparing' when 'rejected' then 'adjustment' when 'review' then 'review' else 'unavailable' end,prepared_for=case when target='approved' then (select guests from reservations where id=s.reservation_id) end where id=s.unit_id;
   elsif (s.order_type='checkout' and target in('in_progress','review','approved','rejected')) or (s.blocking and target not in('approved','cancelled')) then update units set operational_status='unavailable',prepared_for=null where id=s.unit_id; end if;
   perform audit((select property_id from units where id=s.unit_id),s.id,'work_order.status_changed',to_jsonb(s),jsonb_build_object('status',target,'activity_id',a.id),why);
   perform notify(s.assignee,s.activity_id,'Status da ordem alterado',why);
 else raise exception 'Ação inválida'; end if;
 if s.reservation_id is not null then perform notify_agenda(s.unit_id,s.reservation_id,'Ordem de serviço atualizada'); end if;
end $$;
revoke all on function public.manage_work_order(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_work_order(uuid,integer,text,jsonb) to authenticated;

drop policy activity_read on public.activities;
create policy activity_read on public.activities for select to authenticated using(can_unit(unit_id,true) or (deleted_at is null and assignee=auth.uid() and can_unit(unit_id)));
drop policy service_read on public.service_orders;
create policy service_read on public.service_orders for select to authenticated using(can_unit(unit_id,true) or (deleted_at is null and assignee=auth.uid() and can_unit(unit_id)));
create or replace function public.can_activity(a uuid) returns boolean language sql stable security definer set search_path=public as $$select can_unit(unit_id,true) or (deleted_at is null and assignee=auth.uid() and can_unit(unit_id)) from activities where id=a$$;

-- Hospedagens excluídas deixam de bloquear datas. Restaurar verifica sobreposição.
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
   if exists(select 1 from reservations where cancelled_at is null and unit_id=u.id and checkin<departure and checkout>arrival) then raise exception 'Há outra hospedagem neste período'; end if;
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
   select * into origin from service_orders where id=(payload->>'checkin_order_id')::uuid and unit_id=u.id and order_type='checkin' and deleted_at is null and status<>'cancelled';
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
 if r.cancelled_at is not null or s.deleted_at is not null then raise exception 'A hospedagem ou ordem foi excluída'; end if;
 if expected_revision is null or r.revision<>expected_revision then raise exception 'A hospedagem foi alterada. Atualize a agenda'; end if;
 if s.status not in('assigned','in_progress','rejected') then raise exception 'O checkout já foi iniciado ou enviado para revisão; preserve seu histórico'; end if;
 d:=(payload->>'checkout')::date; tm:=coalesce(nullif(payload->>'checkout_time','')::time,r.checkout_time);
 start_tm:=coalesce(nullif(payload->>'checkout_start_time','')::time,r.checkout_start_time);
 if nullif(payload->>'checkout_start_time','') is null and start_tm>tm then start_tm:=tm; end if;
 if start_tm>tm or (nullif(payload->>'checkout_start_time','') is not null and start_tm=tm) then raise exception 'O fim deve ser depois do início'; end if;
 if s.status<>'assigned' and (d<>r.checkout or d<>(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'O checkout já foi iniciado: ajuste somente o horário no dia da execução'; end if;
 if d is null or d<=r.checkin or length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Informe uma saída válida e justifique a alteração'; end if;
 if exists(select 1 from reservations where cancelled_at is null and unit_id=u.id and id<>r.id and checkin<d and checkout>r.checkin) then raise exception 'A nova saída conflita com outra hospedagem'; end if;
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
 left join service_orders so on so.reservation_id=r.id and so.order_type='checkout' where r.cancelled_at is null and can_unit(r.unit_id);


notify pgrst,'reload schema';


create or replace function public.refresh_scheduled_occupancy(u uuid) returns void language plpgsql security definer set search_path=public as $$
declare a record; target integer; next_occ integer; begin
 for a in select x.id,x.cycle_id,x.occupancy,x.template_id,r.checkout,r.id as reservation_id
 from activities x join preparation_cycles c on c.id=x.cycle_id join reservations r on r.id=c.reservation_id
 where x.unit_id=u and x.kind='cleaning' and x.status='pending' and x.started_at is null and r.cancelled_at is null and x.deleted_at is null
 and not exists(select 1 from service_orders s where s.activity_id=x.id)
 for update of x loop
   select guests into next_occ from reservations where cancelled_at is null and unit_id=u and id<>a.reservation_id and checkin>=a.checkout order by checkin,id limit 1;
   select coalesce(next_occ,base_occupancy) into target from units where id=u;
   update preparation_cycles set occupancy=target,occupancy_source=case when next_occ is null then 'base' else 'reservation' end where id=a.cycle_id;
   if target<>a.occupancy then update activities set occupancy=target,items=applicable_items((select items from checklist_template_versions where id=a.template_id),target),revision=revision+1 where id=a.id; end if;
 end loop;
end $$;


notify pgrst,'reload schema';
