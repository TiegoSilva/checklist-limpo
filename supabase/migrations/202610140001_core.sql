-- Horários oficiais UTC; apresentação em America/Sao_Paulo no cliente.
create extension if not exists pgcrypto;
create table public.organizations(id uuid primary key default gen_random_uuid(), name text not null);
create table public.profiles(id uuid primary key references auth.users(id), name text not null, active boolean not null default true, font_scale integer not null default 100 check(font_scale in(100,125,150,200)));
create table public.memberships(org_id uuid references public.organizations, user_id uuid references public.profiles, roles text[] not null check(roles <@ array['admin','manager','inspector','cleaner']::text[] and cardinality(roles)>0), primary key(org_id,user_id));
create table public.properties(id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations, name text not null, address text not null default '', active boolean not null default true);
create table public.user_property_access(property_id uuid references public.properties, user_id uuid references public.profiles, primary key(property_id,user_id));
create table public.units(id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties, name text not null, capacity integer not null check(capacity>0), base_occupancy integer not null check(base_occupancy>0 and base_occupancy<=capacity), operational_status text not null default 'unavailable' check(operational_status in('unavailable','preparing','review','ready','adjustment')), prepared_for integer, commercially_available boolean not null default false, unique(property_id,name));
create table public.environments(id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units, name text not null, unique(unit_id,name));
create table public.checklist_template_versions(id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units, kind text not null check(kind in('inspection','cleaning')), version integer not null, items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)>0), published_at timestamptz not null default now(), published_by uuid not null references public.profiles, unique(unit_id,kind,version));
-- Itens JSON são snapshots versionados: id, room, title, mode, required,
-- evidence_required, expected, min_guests, max_guests, allow_na, reference_path.
create table public.inventory_items(id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units, name text not null, room text not null, category text not null check(category in('permanent','linen','consumable')), expected integer not null check(expected>=0), measure text not null default 'un.', active boolean not null default true);
create table public.stays(id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units, guest_name text not null, guests integer not null check(guests>0), checkin date not null, checkout date not null check(checkout>=checkin), external_id text, created_at timestamptz not null default now());
create table public.preparation_cycles(id uuid primary key default gen_random_uuid(), stay_id uuid not null unique references public.stays, unit_id uuid not null references public.units, occupancy integer not null check(occupancy>0), occupancy_source text not null check(occupancy_source in('base','reservation','override')), created_at timestamptz not null default now());
create table public.activities(id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units, cycle_id uuid references public.preparation_cycles, kind text not null check(kind in('inspection','cleaning','complement')), title text not null, assignee uuid not null references public.profiles, status text not null default 'pending' check(status in('pending','in_progress','review','correction','completed','cancelled')), priority text not null default 'normal' check(priority in('normal','high','urgent')), due_at timestamptz not null, occupancy integer not null check(occupancy>0), template_id uuid not null references public.checklist_template_versions, items jsonb not null, responses jsonb not null default '{}', revision integer not null default 0, attempt integer not null default 1, started_at timestamptz, submitted_at timestamptz, approved_at timestamptz, approved_by uuid references public.profiles, created_at timestamptz not null default now());
create table public.checklist_review_cycles(id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.activities, attempt integer not null, executor uuid not null references public.profiles, snapshot jsonb not null, submitted_at timestamptz not null default now(), reviewer uuid references public.profiles, decision text check(decision in('approved','rejected')), reason text, rejected_items text[] not null default '{}', reviewed_at timestamptz, unique(activity_id,attempt));
create table public.findings(id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.activities, title text not null, description text not null, blocking boolean not null default false, resolved_at timestamptz, created_by uuid not null references public.profiles, created_at timestamptz not null default now());
create table public.service_orders(id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units, finding_id uuid references public.findings, title text not null, description text not null, category text not null default 'Manutenção', priority text not null default 'normal' check(priority in('normal','high','urgent')), assignee uuid not null references public.profiles, due_at timestamptz not null, blocking boolean not null default false, status text not null default 'assigned' check(status in('assigned','in_progress','review','approved','rejected','cancelled')), completion_note text, reviewer uuid references public.profiles, created_by uuid not null references public.profiles, revision integer not null default 0, created_at timestamptz not null default now());
create table public.evidence_files(id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.activities, item_id text not null, attempt integer not null, uploader uuid not null references public.profiles, path text not null unique, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), kind text not null default 'execution' check(kind in('execution','finding')), received_at timestamptz not null default now());
create table public.notifications(id uuid primary key default gen_random_uuid(), recipient uuid not null references public.profiles, activity_id uuid references public.activities, title text not null, message text not null, read_at timestamptz, created_at timestamptz not null default now());
create table public.event_outbox(id uuid primary key default gen_random_uuid(), notification_id uuid not null unique references public.notifications, state text not null default 'pending' check(state in('pending','delivered','failed')), attempts integer not null default 0, next_attempt_at timestamptz not null default now(), last_error text, created_at timestamptz not null default now());
create table public.audit_events(id uuid primary key default gen_random_uuid(), property_id uuid references public.properties, actor uuid not null references public.profiles, actor_roles text[] not null, resource_id uuid not null, event text not null, before_data jsonb, after_data jsonb, reason text, correlation_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now());
create index activities_assignee_due on public.activities(assignee,due_at);
create index activities_unit_status on public.activities(unit_id,status);
create index notifications_recipient on public.notifications(recipient,created_at desc);
create index audit_property_date on public.audit_events(property_id,created_at desc);
create index outbox_pending on public.event_outbox(next_attempt_at) where state='pending';
create index evidence_activity on public.evidence_files(activity_id,item_id);

create function public.org_role(o uuid, wanted text[]) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from memberships m join profiles p on p.id=m.user_id where m.org_id=o and m.user_id=auth.uid() and p.active and m.roles && wanted)
$$;
create function public.can_property(p uuid, manage boolean default false) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from properties x join memberships m on m.org_id=x.org_id join profiles u on u.id=m.user_id where x.id=p and m.user_id=auth.uid() and u.active and (('admin'=any(m.roles)) or (exists(select 1 from user_property_access a where a.property_id=p and a.user_id=auth.uid()) and (not manage or m.roles && array['manager']))))
$$;
create function public.can_unit(u uuid, manage boolean default false) returns boolean language sql stable security definer set search_path=public as $$select can_property(property_id,manage) from units where id=u$$;
create function public.can_activity(a uuid) returns boolean language sql stable security definer set search_path=public as $$select can_unit(unit_id,true) or (assignee=auth.uid() and can_unit(unit_id)) from activities where id=a$$;
create function public.audit(p uuid, r uuid, e text, b jsonb, a jsonb, why text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 insert into audit_events(property_id,actor,actor_roles,resource_id,event,before_data,after_data,reason)
 select p,auth.uid(),m.roles,r,e,b,a,why from memberships m join properties x on x.org_id=m.org_id where x.id=p and m.user_id=auth.uid();
end $$;
create function public.notify(who uuid, a uuid, title text, message text) returns void language plpgsql security definer set search_path=public as $$
declare n uuid;
begin insert into notifications(recipient,activity_id,title,message) values(who,a,title,message) returning id into n; insert into event_outbox(notification_id) values(n); end $$;
create function public.notify_managers(u uuid, a uuid, title text, message text) returns void language plpgsql security definer set search_path=public as $$
declare person record; begin
 for person in select distinct m.user_id from units x join properties p on p.id=x.property_id join memberships m on m.org_id=p.org_id join profiles pr on pr.id=m.user_id where x.id=u and pr.active and ('admin'=any(m.roles) or ('manager'=any(m.roles) and exists(select 1 from user_property_access z where z.property_id=p.id and z.user_id=m.user_id))) loop perform notify(person.user_id,a,title,message); end loop;
end $$;
create function public.assignee_allowed(u uuid, person uuid, kind text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from units x join properties p on p.id=x.property_id join memberships m on m.org_id=p.org_id join profiles pr on pr.id=m.user_id where x.id=u and m.user_id=person and pr.active and m.roles && case when kind='inspection' then array['inspector'] when kind='cleaning' then array['cleaner'] else array['inspector','cleaner','manager','admin'] end and ('admin'=any(m.roles) or exists(select 1 from user_property_access z where z.property_id=p.id and z.user_id=person)))
$$;

-- Todas as mutações passam por funções transacionais; clientes não escrevem tabelas críticas.
create function public.bootstrap(org_name text, full_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare o uuid; begin
 if auth.uid() is null or exists(select 1 from memberships where user_id=auth.uid()) then raise exception 'Não autorizado ou organização já configurada'; end if;
 if length(trim(org_name))<2 or length(trim(full_name))<2 then raise exception 'Informe os nomes'; end if;
 insert into profiles(id,name) values(auth.uid(),trim(full_name)) on conflict(id) do nothing;
 insert into organizations(name) values(trim(org_name)) returning id into o;
 insert into memberships values(o,auth.uid(),array['admin','manager','inspector','cleaner']); return o;
end $$;
create function public.configure(action text, payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare p uuid; u uuid; result uuid; o uuid; v integer; item jsonb; begin
 if action='property' then
 o:=(payload->>'org_id')::uuid; if not org_role(o,array['admin']) then raise exception 'Acesso negado'; end if;
 insert into properties(org_id,name,address) values(o,payload->>'name',coalesce(payload->>'address','')) returning id into result;
 p:=result;
 elsif action='member' then
 o:=(payload->>'org_id')::uuid; if not org_role(o,array['admin']) then raise exception 'Acesso negado'; end if;
 select id into result from auth.users where lower(email)=lower(payload->>'email'); if result is null then raise exception 'Crie primeiro o usuário no Supabase Auth'; end if;
 insert into profiles(id,name) values(result,payload->>'name') on conflict(id) do update set name=excluded.name;
 insert into memberships(org_id,user_id,roles) values(o,result,array(select jsonb_array_elements_text(payload->'roles'))) on conflict(org_id,user_id) do update set roles=excluded.roles;
 if not exists(select 1 from memberships where org_id=o and 'admin'=any(roles)) then raise exception 'Mantenha ao menos um administrador'; end if;
 delete from user_property_access where user_id=result and property_id in(select id from properties where org_id=o);
 insert into user_property_access select x.id,result from properties x where x.org_id=o and x.id in(select value::text::uuid from jsonb_array_elements_text(payload->'properties'));
 -- Escopo organizacional para auditoria de associação.
 insert into audit_events(actor,actor_roles,resource_id,event,after_data) select auth.uid(),roles,result,'member.configured',payload-'email' from memberships where org_id=o and user_id=auth.uid();
 return result;
 else
 if action='unit' then p:=(payload->>'property_id')::uuid; else u:=(payload->>'unit_id')::uuid; select property_id into p from units where id=u; end if;
 if not coalesce(can_property(p,true),false) then raise exception 'Acesso negado'; end if;
 if action='unit' then
 insert into units(property_id,name,capacity,base_occupancy) values(p,payload->>'name',(payload->>'capacity')::integer,(payload->>'base_occupancy')::integer) returning id into result;
 elsif action='environment' then insert into environments(unit_id,name) values(u,payload->>'name') returning id into result;
 elsif action='inventory' then insert into inventory_items(unit_id,name,room,category,expected) values(u,payload->>'name',payload->>'room',payload->>'category',(payload->>'expected')::integer) returning id into result;
 elsif action='template' then
 if payload->>'kind' not in('inspection','cleaning') or jsonb_array_length(payload->'items')=0 then raise exception 'Checklist vazio ou inválido'; end if;
 for item in select * from jsonb_array_elements(payload->'items') loop
 if coalesce(item->>'id','')='' or coalesce(item->>'title','')='' or coalesce(item->>'room','')='' or coalesce(item->>'mode','') not in('task','technical','count') then raise exception 'Item de checklist inválido'; end if;
 if item->>'mode'='count' and coalesce((item->>'expected')::integer,-1)<0 then raise exception 'Quantidade de referência inválida'; end if;
 if coalesce((item->>'min_guests')::integer,1)>coalesce((item->>'max_guests')::integer,999) then raise exception 'Faixa de ocupação inválida'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(payload->'items'))<>(select count(distinct value->>'id') from jsonb_array_elements(payload->'items')) then raise exception 'IDs duplicados'; end if;
 perform pg_advisory_xact_lock(hashtext(u::text|| (payload->>'kind')));
 select coalesce(max(version),0)+1 into v from checklist_template_versions where unit_id=u and kind=payload->>'kind';
 insert into checklist_template_versions(unit_id,kind,version,items,published_by) values(u,payload->>'kind',v,payload->'items',auth.uid()) returning id into result;
 else raise exception 'Operação desconhecida'; end if;
 end if;
 if length(trim(payload->>'name'))<1 then raise exception 'Nome obrigatório'; end if;
 perform audit(p,result,'configuration.'||action,null,payload); return result;
end $$;

create function public.confirm_checkout(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare u units; st uuid; c uuid; t checklist_template_versions; k text; items jsonb; person uuid; a uuid; p uuid; occ integer; next_occupancy integer; begin
 select * into u from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 st:=(payload->>'event_id')::uuid;
 select id into c from preparation_cycles where stay_id=st; if c is not null then return c; end if;
 if exists(select 1 from activities where unit_id=u.id and status not in('completed','cancelled')) then raise exception 'A unidade já possui preparação em aberto'; end if;
 select guests into next_occupancy from reservations where unit_id=u.id and checkin>=(payload->>'checkout')::date order by checkin limit 1;
 occ:=coalesce((payload->>'occupancy')::integer,next_occupancy,u.base_occupancy);
 if occ<1 or occ>u.capacity or (payload->>'guests')::integer>u.capacity then raise exception 'Ocupação inválida'; end if;
 if occ<>coalesce(next_occupancy,u.base_occupancy) and length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Justifique a exceção de ocupação'; end if;
 insert into stays(id,unit_id,guest_name,guests,checkin,checkout) values(st,u.id,payload->>'guest_name',(payload->>'guests')::integer,(payload->>'checkin')::date,(payload->>'checkout')::date);
 insert into preparation_cycles(stay_id,unit_id,occupancy,occupancy_source) values(st,u.id,occ,case when occ<>coalesce(next_occupancy,u.base_occupancy) then 'override' when next_occupancy is not null then 'reservation' else 'base' end) returning id into c;
 foreach k in array array['inspection','cleaning'] loop
 select * into t from checklist_template_versions where unit_id=u.id and kind=k order by version desc limit 1;
 if t.id is null then raise exception 'Publique os dois tipos de checklist antes de confirmar o checkout'; end if;
 person:=(payload->>case when k='inspection' then 'inspector' else 'cleaner' end)::uuid;
 if not assignee_allowed(u.id,person,k) then raise exception 'Responsável sem função ou acesso à unidade'; end if;
 items:=applicable_items(t.items,occ);
 if jsonb_array_length(items)=0 then raise exception 'Nenhuma tarefa aplicável à ocupação'; end if;
 insert into activities(unit_id,cycle_id,kind,title,assignee,due_at,occupancy,template_id,items) values(u.id,c,k,case k when 'inspection' then 'Vistoria de checkout' else 'Limpeza e arrumação' end,person,(payload->>'due_at')::timestamptz,occ,t.id,items) returning id into a;
 perform notify(person,a,'Nova atividade atribuída',u.name||' · '||case k when 'inspection' then 'Vistoria de checkout' else 'Limpeza e arrumação' end);
 end loop;
 update units set operational_status='preparing' where id=u.id;
 perform audit(u.property_id,c,'checkout.confirmed',null,payload-'guest_name',payload->>'reason'); return c;
end $$;

create function public.validate_submission(a public.activities) returns void language plpgsql security definer set search_path=public as $$
declare i jsonb; r jsonb; begin
 for i in select * from jsonb_array_elements(a.items) loop
 r:=a.responses->(i->>'id');
 if coalesce((i->>'required')::boolean,true) and (r is null or coalesce((r->>'confirmed')::boolean,false)=false) then raise exception 'Confira explicitamente todos os itens obrigatórios'; end if;
 if coalesce((r->>'confirmed')::boolean,false) then
 if i->>'mode'='count' and (coalesce((r->>'found')::integer,-1)<0 or coalesce(r->>'condition','') not in('ok','damaged','broken','missing','moved','divergent')) then raise exception 'Quantidade ou condição inválida'; end if;
 if i->>'mode'='technical' and (coalesce(r->>'answer','') not in('ok','issue','na') or (r->>'answer'='na' and not coalesce((i->>'allow_na')::boolean,false))) then raise exception 'Resposta técnica inválida'; end if;
 if ((i->>'mode'='count' and ((r->>'found')::integer<>(i->>'expected')::integer or r->>'condition'<>'ok')) or r->>'answer'='issue') and length(trim(coalesce(r->>'note','')))<5 then raise exception 'Descreva a divergência'; end if;
 if coalesce((i->>'evidence_required')::boolean,false) and not exists(select 1 from evidence_files e where e.activity_id=a.id and e.item_id=i->>'id' and (a.attempt=1 or not exists(select 1 from checklist_review_cycles rc where rc.activity_id=a.id and rc.attempt=a.attempt-1 and i->>'id'=any(rc.rejected_items)) or e.attempt=a.attempt)) then raise exception 'Anexe as fotografias obrigatórias da execução ou correção'; end if;
 end if;
 end loop;
end $$;
create function public.activity_action(activity uuid, expected_revision integer, action text, payload jsonb default '{}') returns integer language plpgsql security definer set search_path=public as $$
declare a activities; old jsonb; p uuid; rr jsonb; response_item record; rejected text[]; begin
 select * into a from activities where id=activity for update;
 if not found or not coalesce(can_activity(activity),false) then raise exception 'Acesso negado'; end if;
 if a.revision<>expected_revision then raise exception 'CONFLICT: atividade alterada; recarregue antes de enviar'; end if;
 old:=to_jsonb(a); select property_id into p from units where id=a.unit_id;
 if action in('start','save','submit') then
 if a.assignee<>auth.uid() then raise exception 'Apenas o responsável pode executar'; end if;
 if a.status not in('pending','in_progress','correction') then raise exception 'Estado não permite execução'; end if;
 if action='start' then
 update activities set status='in_progress',started_at=coalesce(started_at,now()) where id=activity;
 elsif action='save' then
 if a.status='pending' then raise exception 'Inicie a atividade'; end if;
 rr:=payload->'responses'; if jsonb_typeof(rr)<>'object' then raise exception 'Respostas inválidas'; end if;
 for response_item in select * from jsonb_each(rr) loop
 if not exists(select 1 from jsonb_array_elements(a.items) i where i->>'id'=response_item.key) then raise exception 'Item desconhecido'; end if;
 if a.attempt>1 and exists(select 1 from checklist_review_cycles rc where rc.activity_id=a.id and rc.attempt=a.attempt-1 and not(response_item.key=any(rc.rejected_items))) and response_item.value is distinct from a.responses->response_item.key then raise exception 'Altere somente os itens devolvidos para correção'; end if;
 end loop;
 update activities set responses=rr where id=activity;
 elsif action='submit' then
 if a.status='pending' then raise exception 'Inicie a atividade'; end if;
 perform validate_submission(a);
 insert into checklist_review_cycles(activity_id,attempt,executor,snapshot) values(a.id,a.attempt,auth.uid(),to_jsonb(a));
 update activities set status=case when a.kind='inspection' then 'completed' else 'review' end,submitted_at=now() where id=activity;
 if a.kind<>'inspection' then update units set operational_status='review' where id=a.unit_id; end if;
 perform notify_managers(a.unit_id,a.id,case when a.kind='inspection' then 'Vistoria concluída' else 'Arrumação aguardando aprovação' end,a.title);
 end if;
 elsif action in('approve','reject') then
 if not can_unit(a.unit_id,true) or a.assignee=auth.uid() or exists(select 1 from audit_events where resource_id=a.id and actor=auth.uid() and event in('activity.start','activity.save','activity.submit')) then raise exception 'Autoaprovação proibida ou gestor não autorizado'; end if;
 if a.status<>'review' then raise exception 'Atividade não aguarda revisão'; end if;
 if action='approve' then
 perform validate_submission(a);
 if not exists(select 1 from activities where cycle_id=a.cycle_id and kind='inspection' and status='completed') then raise exception 'Conclua a vistoria de checkout antes da liberação'; end if;
 if exists(select 1 from findings f join activities x on x.id=f.activity_id where x.unit_id=a.unit_id and f.blocking and f.resolved_at is null) or exists(select 1 from service_orders where unit_id=a.unit_id and blocking and status not in('approved','cancelled')) then raise exception 'Existem pendências impeditivas'; end if;
 update activities set status='completed',approved_at=now(),approved_by=auth.uid() where id=activity;
 update units set operational_status='ready',prepared_for=a.occupancy where id=a.unit_id;
 update checklist_review_cycles set reviewer=auth.uid(),decision='approved',reviewed_at=now() where activity_id=a.id and attempt=a.attempt;
 perform notify(a.assignee,a.id,'Arrumação aprovada','Unidade liberada pelo gestor.');
 else
 if length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Justificativa obrigatória (mínimo 5 caracteres)'; end if;
 rejected:=array(select jsonb_array_elements_text(coalesce(payload->'items','[]')));
 if cardinality(rejected)=0 or exists(select 1 from unnest(rejected) x where not exists(select 1 from jsonb_array_elements(a.items) i where i->>'id'=x)) then raise exception 'Selecione itens válidos para correção'; end if;
 update checklist_review_cycles set reviewer=auth.uid(),decision='rejected',reason=payload->>'reason',rejected_items=rejected,reviewed_at=now() where activity_id=a.id and attempt=a.attempt;
 update activities set status='correction',attempt=attempt+1,responses=responses-array(select unnest(rejected)) where id=activity;
 update units set operational_status='preparing' where id=a.unit_id;
 perform notify(a.assignee,a.id,'Correção solicitada',payload->>'reason');
 end if;
 elsif action='schedule' then
 if not can_unit(a.unit_id,true) or a.status not in('pending','in_progress','correction') then raise exception 'Programação não permitida'; end if;
 if length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Justifique a mudança'; end if;
 if not assignee_allowed(a.unit_id,(payload->>'assignee')::uuid,a.kind) then raise exception 'Responsável sem acesso ou função'; end if;
 -- Mudança depois de iniciar preserva os executores na auditoria e impede a autoaprovação.
 update activities set assignee=(payload->>'assignee')::uuid,due_at=(payload->>'due_at')::timestamptz,priority=payload->>'priority' where id=activity;
 perform notify(a.assignee,a.id,'Programação alterada',payload->>'reason');
 if a.assignee<>(payload->>'assignee')::uuid then perform notify((payload->>'assignee')::uuid,a.id,'Atividade atribuída',a.title); end if;
 elsif action='cancel' then
 if not can_unit(a.unit_id,true) or a.status in('completed','cancelled') or length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Cancelamento não permitido ou sem justificativa'; end if;
 update activities set status='cancelled' where id=activity;
 update units set operational_status='unavailable' where id=a.unit_id;
 perform notify(a.assignee,a.id,'Atividade cancelada',payload->>'reason');
 else raise exception 'Ação desconhecida'; end if;
 update activities set revision=revision+1 where id=activity returning revision into expected_revision;
 perform audit(p,activity,'activity.'||action,old,(select to_jsonb(x) from activities x where id=activity),payload->>'reason'); return expected_revision;
end $$;

create function public.register_evidence(activity uuid, item text, file_id uuid, hash text) returns void language plpgsql security definer set search_path=public as $$
declare a activities; path text; p uuid; begin
 select * into a from activities where id=activity for update;
 if not coalesce(can_activity(activity),false) or a.assignee<>auth.uid() or a.status not in('in_progress','correction') then raise exception 'Evidência não permitida'; end if;
 if not exists(select 1 from jsonb_array_elements(a.items) i where i->>'id'=item) then raise exception 'Item inválido'; end if;
 path:=activity::text||'/'||file_id::text;
 if not exists(select 1 from storage.objects where bucket_id='evidence' and name=path) then raise exception 'Envie primeiro o arquivo'; end if;
 insert into evidence_files(id,activity_id,item_id,attempt,uploader,path,sha256) values(file_id,activity,item,a.attempt,auth.uid(),path,hash);
 select property_id into p from units where id=a.unit_id;
 perform audit(p,activity,'evidence.received',null,jsonb_build_object('file_id',file_id,'item',item,'sha256',hash));
end $$;
create function public.create_finding(activity uuid, payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare a activities; f uuid; p uuid; begin
 select * into a from activities where id=activity for update;
 if not coalesce(can_activity(activity),false) or a.status in('completed','cancelled') then raise exception 'Acesso negado'; end if;
 if length(trim(payload->>'description'))<5 or length(trim(payload->>'title'))<2 then raise exception 'Descreva a ocorrência'; end if;
 insert into findings(activity_id,title,description,blocking,created_by) values(activity,payload->>'title',payload->>'description',coalesce((payload->>'blocking')::boolean,false),auth.uid()) returning id into f;
 if (payload->>'blocking')::boolean then update units set operational_status='unavailable' where id=a.unit_id; end if;
 select property_id into p from units where id=a.unit_id;
 perform audit(p,f,'finding.created',null,payload); perform notify_managers(a.unit_id,activity,'Irregularidade registrada',payload->>'title'); return f;
end $$;
create function public.resolve_finding(finding uuid, reason text) returns void language plpgsql security definer set search_path=public as $$
declare f findings; u uuid; p uuid; begin
 select * into f from findings where id=finding for update; select unit_id into u from activities where id=f.activity_id;
 if not coalesce(can_unit(u,true),false) or length(trim(reason))<5 then raise exception 'Gestor e justificativa obrigatórios'; end if;
 update findings set resolved_at=now() where id=finding; select property_id into p from units where id=u; perform audit(p,finding,'finding.resolved',to_jsonb(f),null,reason);
end $$;

create function public.service_action(action text, payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare s service_orders; result uuid; u uuid; p uuid; begin
 if action='create' then
 u:=(payload->>'unit_id')::uuid;
 if not coalesce(can_unit(u,true),false) or not assignee_allowed(u,(payload->>'assignee')::uuid,'service') then raise exception 'Acesso negado ou responsável inválido'; end if;
 if payload->>'finding_id' is not null and not exists(select 1 from findings f join activities a on a.id=f.activity_id where f.id=(payload->>'finding_id')::uuid and a.unit_id=u) then raise exception 'Ocorrência de outra unidade'; end if;
 insert into service_orders(unit_id,finding_id,title,description,category,priority,assignee,due_at,blocking,created_by) values(u,(payload->>'finding_id')::uuid,payload->>'title',payload->>'description',coalesce(payload->>'category','Manutenção'),payload->>'priority',(payload->>'assignee')::uuid,(payload->>'due_at')::timestamptz,coalesce((payload->>'blocking')::boolean,false),auth.uid()) returning id into result;
 perform notify((payload->>'assignee')::uuid,null,'Nova ordem de serviço',payload->>'title');
 else
 select * into s from service_orders where id=(payload->>'id')::uuid for update;
 if not found or not can_unit(s.unit_id) or (s.assignee<>auth.uid() and not can_unit(s.unit_id,true)) then raise exception 'Acesso negado'; end if;
 if s.revision<>(payload->>'revision')::integer then raise exception 'CONFLICT: ordem alterada'; end if;
 u:=s.unit_id; result:=s.id;
 if action='start' and s.assignee=auth.uid() and s.status in('assigned','rejected') then update service_orders set status='in_progress' where id=s.id;
 elsif action='submit' and s.assignee=auth.uid() and s.status='in_progress' and length(trim(coalesce(payload->>'note','')))>4 then
 update service_orders set status='review',completion_note=payload->>'note' where id=s.id;
 perform notify_managers(u,null,'Ordem de serviço aguardando revisão',s.title);
 elsif action in('approve','reject') and can_unit(u,true) and s.assignee<>auth.uid() and s.status='review' then
 if action='reject' and length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Justifique a reprovação'; end if;
 update service_orders set status=case action when 'approve' then 'approved' else 'rejected' end,reviewer=auth.uid() where id=s.id;
 perform notify(s.assignee,null,case action when 'approve' then 'Ordem aprovada' else 'Correção na ordem de serviço' end,coalesce(payload->>'reason',s.title));
 else raise exception 'Transição não permitida'; end if;
 update service_orders set revision=revision+1 where id=s.id;
 end if;
 if coalesce((payload->>'blocking')::boolean,s.blocking,false) then update units set operational_status='unavailable' where id=u; end if;
 select property_id into p from units where id=u;
 perform audit(p,result,'service.'||action,to_jsonb(s),payload,payload->>'reason'); return result;
end $$;
create function public.set_preferences(scale integer) returns void language plpgsql security definer set search_path=public as $$begin update profiles set font_scale=scale where id=auth.uid(); end$$;
create function public.read_notification(notification uuid) returns void language plpgsql security definer set search_path=public as $$begin update notifications set read_at=now() where id=notification and recipient=auth.uid(); end$$;

-- RLS: privilégio mínimo, inclusive chamadas diretas fora da interface.
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table properties enable row level security;
alter table user_property_access enable row level security;
alter table units enable row level security;
alter table environments enable row level security;
alter table checklist_template_versions enable row level security;
alter table inventory_items enable row level security;
alter table stays enable row level security;
alter table preparation_cycles enable row level security;
alter table activities enable row level security;
alter table checklist_review_cycles enable row level security;
alter table findings enable row level security;
alter table service_orders enable row level security;
alter table evidence_files enable row level security;
alter table notifications enable row level security;
alter table event_outbox enable row level security;
alter table audit_events enable row level security;
create policy org_read on organizations for select to authenticated using(org_role(id,array['admin','manager','cleaner','inspector']));
create policy profile_read on profiles for select to authenticated using(id=auth.uid() or exists(select 1 from memberships m where m.user_id=profiles.id and org_role(m.org_id,array['admin','manager'])));
create policy member_read on memberships for select to authenticated using(user_id=auth.uid() or org_role(org_id,array['admin','manager']));
create policy access_read on user_property_access for select to authenticated using(user_id=auth.uid() or can_property(property_id,true));
create policy property_read on properties for select to authenticated using(can_property(id));
create policy unit_read on units for select to authenticated using(can_property(property_id));
create policy environment_read on environments for select to authenticated using(can_unit(unit_id));
create policy template_read on checklist_template_versions for select to authenticated using(can_unit(unit_id));
create policy inventory_read on inventory_items for select to authenticated using(can_unit(unit_id));
create policy stay_read on stays for select to authenticated using(can_unit(unit_id,true) or exists(select 1 from preparation_cycles c join activities a on a.cycle_id=c.id where c.stay_id=stays.id and a.assignee=auth.uid() and can_unit(a.unit_id)));
create policy cycle_read on preparation_cycles for select to authenticated using(can_unit(unit_id,true) or exists(select 1 from activities a where a.cycle_id=preparation_cycles.id and a.assignee=auth.uid() and can_unit(a.unit_id)));
create policy activity_read on activities for select to authenticated using(can_unit(unit_id,true) or (assignee=auth.uid() and can_unit(unit_id)));
create policy review_read on checklist_review_cycles for select to authenticated using(can_activity(activity_id));
create policy finding_read on findings for select to authenticated using(can_activity(activity_id));
create policy service_read on service_orders for select to authenticated using(can_unit(unit_id,true) or (assignee=auth.uid() and can_unit(unit_id)));
create policy evidence_read on evidence_files for select to authenticated using(can_activity(activity_id));
create policy notification_read on notifications for select to authenticated using(recipient=auth.uid() and exists(select 1 from profiles where id=auth.uid() and active));
create policy audit_read on audit_events for select to authenticated using(can_property(property_id,true) or (property_id is null and exists(select 1 from memberships m where m.user_id=audit_events.actor and org_role(m.org_id,array['admin']))));

revoke all on all tables in schema public from anon,authenticated;
grant select on all tables in schema public to authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.org_role(uuid,text[]),public.can_property(uuid,boolean),public.can_unit(uuid,boolean),public.can_activity(uuid) to authenticated;
grant execute on function public.bootstrap(text,text),public.configure(text,jsonb),public.confirm_checkout(jsonb),public.activity_action(uuid,integer,text,jsonb),public.register_evidence(uuid,text,uuid,text),public.create_finding(uuid,jsonb),public.resolve_finding(uuid,text),public.service_action(text,jsonb),public.set_preferences(integer),public.read_notification(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('evidence','evidence',false,10485760,array['image/jpeg','image/png','image/webp']),('references','references',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy evidence_upload on storage.objects for insert to authenticated with check(bucket_id='evidence' and exists(select 1 from activities a where a.id::text=(storage.foldername(name))[1] and a.assignee=auth.uid() and a.status in('in_progress','correction') and can_unit(a.unit_id)));
create policy evidence_download on storage.objects for select to authenticated using(bucket_id='evidence' and exists(select 1 from evidence_files e where e.path=name and can_activity(e.activity_id)));
create policy reference_upload on storage.objects for insert to authenticated with check(bucket_id='references' and exists(select 1 from units u where u.id::text=(storage.foldername(name))[1] and can_unit(u.id,true)));
create policy reference_download on storage.objects for select to authenticated using(bucket_id='references' and exists(select 1 from units u where u.id::text=(storage.foldername(name))[1] and can_unit(u.id)));
-- Sem UPDATE/DELETE de imagens: evidências e referências não são substituídas.
alter publication supabase_realtime add table public.activities,public.notifications,public.units,public.service_orders;
