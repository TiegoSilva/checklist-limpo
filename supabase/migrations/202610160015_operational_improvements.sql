-- Execução confiável, horários fixos e simplificação operacional. Aplicar após 014.
update storage.buckets set file_size_limit=209715200 where id in('evidence','service-evidence');
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.receive_media_evidence(uuid,uuid,text,text,uuid,text,text,bigint)'::regprocedure);
 execute replace(replace(definition,'52428800','209715200'),'10485760','26214400');
 definition:=pg_get_functiondef('public.create_work_order(jsonb)'::regprocedure);
 definition:=replace(definition,$find$coalesce(nullif(payload->>'checkout_time','')::time,time '12:30')$find$,$replacement$time '12:30'$replacement$);
 definition:=replace(definition,$find$coalesce(nullif(payload->>'checkout_start_time','')::time,time '11:30')$find$,$replacement$time '12:00'$replacement$);
 execute definition;
end $$;
alter function public.reschedule_checkout(uuid,integer,jsonb) rename to reschedule_checkout_before_fixed_window;
revoke all on function public.reschedule_checkout_before_fixed_window(uuid,integer,jsonb) from public,anon,authenticated;
create function public.reschedule_checkout(reservation uuid,expected_revision integer,payload jsonb) returns void language plpgsql security definer set search_path=public as $$
begin perform reschedule_checkout_before_fixed_window(reservation,expected_revision,payload||jsonb_build_object('checkout_start_time','12:00','checkout_time','12:30')); end $$;
revoke all on function public.reschedule_checkout(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reschedule_checkout(uuid,integer,jsonb) to authenticated;
create or replace function public.create_scheduled_work_order(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
begin return create_work_order(payload||jsonb_build_object('checkout_start_time','12:00','checkout_time','12:30')); end $$;
create or replace function public.reschedule_checkout_window(reservation uuid,expected_revision integer,payload jsonb) returns void language plpgsql security definer set search_path=public as $$
begin perform reschedule_checkout(reservation,expected_revision,payload||jsonb_build_object('checkout_start_time','12:00','checkout_time','12:30')); end $$;

create function public.read_notifications(notification_ids uuid[]) returns integer language plpgsql security definer set search_path=public as $$
declare changed integer; begin
 update public.notifications set read_at=now() where id=any(notification_ids) and recipient=auth.uid() and read_at is null;
 get diagnostics changed=row_count; return changed;
end $$;
revoke all on function public.read_notifications(uuid[]) from public,anon,authenticated;
grant execute on function public.read_notifications(uuid[]) to authenticated;

create function public.submit_checklist_with_evidence(activity uuid,expected_revision integer,submission uuid,responses jsonb,files uuid[]) returns integer language plpgsql security definer set search_path=public as $$
declare a activities; missing uuid; begin
 select * into a from activities where id=activity;
 -- Mesma ordem de bloqueio do fluxo original para evitar corrida com recibos/revisão.
 perform 1 from units where id=a.unit_id for update;
 perform 1 from service_orders where activity_id=activity for update;
 select * into a from activities where id=activity for update;
 if a.id is null or a.assignee<>auth.uid() or not coalesce(can_activity(a.id),false) then raise exception 'Acesso negado'; end if;
 if files is null or cardinality(files)>8 or cardinality(files)<>(select count(distinct id) from unnest(files) id) then raise exception 'Lista de arquivos inválida ou duplicada'; end if;
 select selected.file_id into missing from unnest(files) as selected(file_id) where not exists(select 1 from evidence_files e where e.id=selected.file_id and e.activity_id=a.id and e.uploader=auth.uid() and e.attempt=a.attempt) limit 1;
 if missing is not null then raise exception 'Arquivo % ainda não confirmado pelo servidor. Aguarde o upload e tente novamente.',missing; end if;
 return submit_checklist(activity,expected_revision,submission,responses);
end $$;
revoke all on function public.submit_checklist_with_evidence(uuid,integer,uuid,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.submit_checklist_with_evidence(uuid,integer,uuid,jsonb,uuid[]) to authenticated;

alter table public.properties add column revision integer not null default 0;
alter table public.units add column revision integer not null default 0;
create function public.save_location(kind text,payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p properties; u units; label text:=trim(coalesce(payload->>'name','')); cap integer; base integer; begin
 if label='' or length(label)>160 then raise exception 'Informe um nome de até 160 caracteres'; end if;
 if kind='property' then
   select * into p from properties where id=(payload->>'id')::uuid for update;
   if p.id is null or not coalesce(can_property(p.id,true),false) then raise exception 'Acesso negado'; end if;
   if (payload->>'revision')::integer is distinct from p.revision then raise exception 'A propriedade foi alterada. Reabra a edição'; end if;
   update properties set name=label,address=trim(coalesce(payload->>'address','')),revision=revision+1 where id=p.id;
   perform audit(p.id,p.id,'property.updated',to_jsonb(p),payload);
 elsif kind='unit' then
   select * into u from units where id=(payload->>'id')::uuid for update;
   if u.id is null or not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
   if (payload->>'revision')::integer is distinct from u.revision then raise exception 'A unidade foi alterada. Reabra a edição'; end if;
   cap:=(payload->>'capacity')::integer; base:=(payload->>'base_occupancy')::integer;
   if cap is null or base is null or base<1 or base>cap then raise exception 'A capacidade deve ser maior ou igual à ocupação-base, com mínimo de 1 hóspede'; end if;
   if exists(select 1 from reservations where unit_id=u.id and checkout>=(now() at time zone 'America/Sao_Paulo')::date and guests>cap) then raise exception 'Há hospedagens com mais hóspedes que a nova capacidade. Ajuste as reservas antes'; end if;
   update units set name=label,capacity=cap,base_occupancy=base,revision=revision+1 where id=u.id;
   perform audit(u.property_id,u.id,'unit.updated',to_jsonb(u),payload);
 else raise exception 'Cadastro inválido'; end if;
end $$;
revoke all on function public.save_location(text,jsonb) from public,anon,authenticated;
grant execute on function public.save_location(text,jsonb) to authenticated;

create table public.inventory_batches(id uuid primary key,actor uuid not null references profiles,payload jsonb not null,created_at timestamptz not null default now());
alter table public.inventory_batches enable row level security;
revoke all on public.inventory_batches from public,anon,authenticated;
create function public.save_inventory_batch(destination uuid,items jsonb,batch uuid) returns void language plpgsql security definer set search_path=public as $$
declare saved inventory_batches; item jsonb; current_item inventory_items; begin
 if not coalesce(can_unit(destination,true),false) then raise exception 'Acesso negado'; end if;
 perform 1 from units where id=destination for update;
 if batch is null or jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 300 then raise exception 'Envie de 1 a 300 itens com identificador do lote'; end if;
 select * into saved from inventory_batches where id=batch;
 if saved.id is not null then
   if saved.actor=auth.uid() and saved.payload=jsonb_build_object('destination',destination,'items',items) then return; end if;
   raise exception 'Identificador de lote já utilizado';
 end if;
 if exists(select 1 from jsonb_array_elements(items) i group by lower(trim(i->>'room')),lower(trim(i->>'name')) having count(*)>1) then raise exception 'Há itens repetidos no lote. Revise nome e ambiente'; end if;
 for item in select value from jsonb_array_elements(items) loop
   if nullif(item->>'id','') is not null then
     select * into current_item from inventory_items where id=(item->>'id')::uuid;
     if current_item.unit_id is distinct from destination then raise exception 'O item editado não pertence à unidade de destino'; end if;
   end if;
   if exists(select 1 from inventory_items i where i.unit_id=destination and i.active and lower(trim(i.name))=lower(trim(item->>'name')) and lower(trim(i.room))=lower(coalesce(nullif(trim(item->>'room'),''),'Geral')) and i.id is distinct from nullif(item->>'id','')::uuid) then raise exception 'Já existe o item % no ambiente %. Edite-o em vez de duplicar.',item->>'name',item->>'room'; end if;
   perform save_inventory_item(item||jsonb_build_object('unit_id',destination));
 end loop;
 insert into inventory_batches values(batch,auth.uid(),jsonb_build_object('destination',destination,'items',items),now());
end $$;
revoke all on function public.save_inventory_batch(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_inventory_batch(uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';

-- Datas das tarefas simples para relatórios com o mesmo critério das vistorias.
alter table public.service_orders add column started_at timestamptz,add column submitted_at timestamptz,add column approved_at timestamptz;
create function public.track_service_times() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status is distinct from old.status then
   if new.status='assigned' then new.started_at:=null;new.submitted_at:=null;new.approved_at:=null;
   elsif new.status='in_progress' then new.started_at:=coalesce(new.started_at,now());new.approved_at:=null;
   elsif new.status='review' then new.submitted_at:=now();new.approved_at:=null;
   elsif new.status='approved' then new.approved_at:=now(); end if;
 end if;
 return new;
end $$;
create trigger service_times before update on public.service_orders for each row execute function public.track_service_times();
update service_orders s set started_at=(select min(created_at) from audit_events where resource_id=s.id and event='service.start'),submitted_at=(select max(created_at) from audit_events where resource_id=s.id and event='service.submit'),approved_at=(select max(created_at) from audit_events where resource_id=s.id and event='service.approve');
create index if not exists service_unit_due on public.service_orders(unit_id,due_at);
create index if not exists activities_unit_due on public.activities(unit_id,due_at);

-- Leituras com RLS, paginação, filtro de propriedade e período no servidor.
create function public.operation_page(resource text,property_id uuid default null,page_offset integer default 0,page_size integer default 500,from_date date default null,to_date date default null,criterion text default 'due_at',open_only boolean default false) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare predicate text:='true'; ordering text:='id'; date_column text; result jsonb; total bigint; begin
 if resource<>all(array['team_agenda','service_evidence','properties','units','activities','profiles','memberships','organizations','notifications','service_orders','evidence_files','checklist_review_cycles','findings','audit_events','inventory_items','checklist_template_versions','environments','stays','preparation_cycles']) then raise exception 'Recurso de consulta inválido'; end if;
 if resource='memberships' then ordering:='org_id,user_id'; end if;
 if property_id is not null then
   if resource=any(array['activities','service_orders','inventory_items','checklist_template_versions','environments','stays','preparation_cycles','team_agenda']) then predicate:='unit_id in(select id from units where units.property_id=$1)';
   elsif resource='audit_events' then predicate:='property_id=$1';
   elsif resource=any(array['evidence_files','checklist_review_cycles','findings']) then predicate:='activity_id in(select id from activities where unit_id in(select id from units where units.property_id=$1))';
   elsif resource='service_evidence' then predicate:='service_id in(select id from service_orders where unit_id in(select id from units where units.property_id=$1))'; end if;
 end if;
 if open_only then
   if resource=any(array['activities','service_orders']) then predicate:=predicate||' and (status not in(''completed'',''approved'',''cancelled'') or due_at>=date_trunc(''day'',now())-interval ''7 days'')';
   elsif resource='team_agenda' then predicate:=predicate||' and checkout>=(now() at time zone ''America/Sao_Paulo'')::date-7';
   elsif resource=any(array['evidence_files','checklist_review_cycles','findings']) then predicate:=predicate||' and activity_id in(select id from activities where status not in(''completed'',''cancelled'') or due_at>=date_trunc(''day'',now())-interval ''7 days'')';
   elsif resource='service_evidence' then predicate:=predicate||' and service_id in(select id from service_orders where status not in(''approved'',''cancelled'') or due_at>=date_trunc(''day'',now())-interval ''7 days'')'; end if;
 end if;
 if from_date is not null and to_date is not null and resource=any(array['activities','service_orders']) then
   if criterion<>all(array['due_at','created_at','submitted_at','approved_at']) or criterion is null then raise exception 'Critério de período inválido'; end if;
   if to_date<from_date then raise exception 'Período inválido'; end if;
   date_column:=format('%I',criterion);
   if resource='service_orders' and criterion in('submitted_at','approved_at') then date_column:=format('coalesce((select a.%I from activities a where a.id=service_orders.activity_id),service_orders.%I)',criterion,criterion); end if;
   predicate:=predicate||format(' and (%s at time zone ''America/Sao_Paulo'')::date between $4 and $5',date_column);
 end if;
 execute format('select count(*) from public.%I where %s',resource,predicate) into total using property_id,page_size,page_offset,from_date,to_date;
 execute format('select coalesce(jsonb_agg(to_jsonb(page)),''[]''::jsonb) from(select * from public.%I where %s order by %s limit $2 offset $3) page',resource,predicate,ordering) into result using property_id,least(greatest(page_size,1),500),greatest(page_offset,0),from_date,to_date;
 return jsonb_build_object('rows',result,'total',total);
end $$;
revoke all on function public.operation_page(text,uuid,integer,integer,date,date,text,boolean) from public,anon,authenticated;
grant execute on function public.operation_page(text,uuid,integer,integer,date,date,text,boolean) to authenticated;
notify pgrst,'reload schema';

-- Manifesto de arquivos esperados: nenhuma transição final passa enquanto houver upload pendente.
create table public.evidence_upload_plans(id uuid primary key,activity_id uuid references activities,service_id uuid references service_orders,attempt integer not null,uploader uuid not null references profiles,cancelled_at timestamptz,created_at timestamptz not null default now(),check((activity_id is null)<>(service_id is null)));
alter table public.evidence_upload_plans enable row level security;
revoke all on public.evidence_upload_plans from public,anon,authenticated;
create index evidence_plans_activity on public.evidence_upload_plans(activity_id,attempt);
create index evidence_plans_service on public.evidence_upload_plans(service_id);
create function public.expect_evidence_uploads(kind text,resource uuid,files uuid[]) returns void language plpgsql security definer set search_path=public as $$
declare a activities;s service_orders;current_attempt integer:=1;file uuid;begin
 if files is null or cardinality(files)>8 or cardinality(files)<>(select count(distinct value) from unnest(files) value) then raise exception 'Lista de arquivos inválida'; end if;
 if kind='activity' then select * into a from activities where id=resource for update;
   if a.id is not null and a.assignee=auth.uid() and coalesce(can_activity(a.id),false) and a.status in('review','completed') and not exists(select 1 from unnest(files) expected(file_id) where not exists(select 1 from evidence_files e where e.id=expected.file_id and e.activity_id=a.id and e.attempt=a.attempt and e.uploader=auth.uid())) then return;end if;
   if a.id is null or a.assignee<>auth.uid() or not coalesce(can_activity(a.id),false) or a.status not in('in_progress','correction') then raise exception 'Envio não autorizado para esta vistoria'; end if;current_attempt:=a.attempt;
 elsif kind='service' then select * into s from service_orders where id=resource for update;
   if s.id is not null and s.assignee=auth.uid() and coalesce(can_unit(s.unit_id),false) and s.status in('review','approved') and not exists(select 1 from unnest(files) expected(file_id) where not exists(select 1 from service_evidence e where e.id=expected.file_id and e.service_id=s.id and e.uploader=auth.uid())) then return;end if;
   if s.id is null or s.assignee<>auth.uid() or not coalesce(can_unit(s.unit_id),false) or s.status<>'in_progress' then raise exception 'Envio não autorizado para esta tarefa'; end if;
 else raise exception 'Recurso inválido';end if;
 foreach file in array files loop
   if exists(select 1 from evidence_upload_plans p where p.id=file and (p.uploader<>auth.uid() or p.attempt<>current_attempt or coalesce(p.activity_id,p.service_id)<>resource)) then raise exception 'Arquivo já vinculado a outra execução';end if;
   insert into evidence_upload_plans(id,activity_id,service_id,attempt,uploader) values(file,case when kind='activity' then resource end,case when kind='service' then resource end,current_attempt,auth.uid()) on conflict(id) do update set cancelled_at=null;
 end loop;
 if kind='activity' and (select count(*) from evidence_upload_plans where activity_id=resource and attempt=current_attempt and cancelled_at is null)>8 then raise exception 'Limite de oito arquivos por execução';end if;
end $$;
create function public.cancel_evidence_upload(kind text,resource uuid,file uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if kind='activity' then perform 1 from activities where id=resource and assignee=auth.uid() and can_activity(id) and status in('in_progress','correction') for update;
 elsif kind='service' then perform 1 from service_orders where id=resource and assignee=auth.uid() and can_unit(unit_id) and status='in_progress' for update;
 else raise exception 'Recurso inválido';end if;
 if not found then raise exception 'A execução não permite alterar arquivos';end if;
 if exists(select 1 from evidence_files where id=file) or exists(select 1 from service_evidence where id=file) then return;end if;
 update evidence_upload_plans set cancelled_at=now() where id=file and coalesce(activity_id,service_id)=resource;
end $$;
create function public.require_completed_uploads() returns trigger language plpgsql security definer set search_path=public as $$
declare missing uuid;begin
 if new.status in('review','completed','approved') then
   if TG_TABLE_NAME='activities' then select p.id into missing from evidence_upload_plans p where p.activity_id=new.id and p.attempt=new.attempt and p.cancelled_at is null and not exists(select 1 from evidence_files e where e.id=p.id and e.activity_id=new.id and e.uploader=p.uploader and e.attempt=new.attempt) limit 1;
   else select p.id into missing from evidence_upload_plans p where p.service_id=new.id and p.cancelled_at is null and not exists(select 1 from service_evidence e where e.id=p.id and e.service_id=new.id and e.uploader=p.uploader) limit 1;end if;
   if missing is not null then raise exception 'Arquivo % ainda aguardando upload ou confirmação. Retome o envio antes de concluir.',missing;end if;
 end if;return new;
end $$;
create trigger activity_uploads_complete before update of status on public.activities for each row execute function public.require_completed_uploads();
create trigger service_uploads_complete before update of status on public.service_orders for each row execute function public.require_completed_uploads();
revoke all on function public.expect_evidence_uploads(text,uuid,uuid[]),public.cancel_evidence_upload(text,uuid,uuid),public.require_completed_uploads() from public,anon,authenticated;
grant execute on function public.expect_evidence_uploads(text,uuid,uuid[]),public.cancel_evidence_upload(text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';

create function public.pending_evidence_uploads(kind text,resource uuid) returns uuid[] language plpgsql stable security definer set search_path=public as $$
declare a activities;s service_orders;current_attempt integer:=1;result uuid[];begin
 if kind='activity' then select * into a from activities where id=resource;
   if a.id is null or a.assignee<>auth.uid() or not coalesce(can_activity(a.id),false) then raise exception 'Acesso negado';end if;current_attempt:=a.attempt;
 elsif kind='service' then select * into s from service_orders where id=resource;
   if s.id is null or s.assignee<>auth.uid() or not coalesce(can_unit(s.unit_id),false) then raise exception 'Acesso negado';end if;
 else raise exception 'Recurso inválido';end if;
 select coalesce(array_agg(p.id),'{}'::uuid[]) into result from evidence_upload_plans p where coalesce(p.activity_id,p.service_id)=resource and p.attempt=current_attempt and p.cancelled_at is null and not exists(select 1 from evidence_files where id=p.id) and not exists(select 1 from service_evidence where id=p.id);
 return result;
end $$;
revoke all on function public.pending_evidence_uploads(text,uuid) from public,anon,authenticated;
grant execute on function public.pending_evidence_uploads(text,uuid) to authenticated;
notify pgrst,'reload schema';
