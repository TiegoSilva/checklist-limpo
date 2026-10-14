-- Edição versionada e itens com quantidade compartilhados entre check-in e checkout.
-- Versões anteriores e atividades executadas nunca são alteradas.
alter table public.checklist_template_versions
  add column publication_source text not null default 'user' check(publication_source in('user','migration'));
alter table public.checklist_template_versions alter column published_by drop not null;
alter table public.checklist_template_versions add constraint template_author_identified
  check(published_by is not null or publication_source='migration');
alter table public.audit_events alter column actor drop not null;
alter table public.audit_events add constraint audit_actor_identified
  check(actor is not null or actor_roles=array['system']::text[]);

-- Na reconciliação de dados antigos, check-in prevalece em nomes/IDs coincidentes.
create function public.shared_count_items(preferred jsonb, other_items jsonb)
returns jsonb language sql immutable set search_path=public as $$
 with preferred_counts as (
   select value item, ordinality position from jsonb_array_elements(preferred) with ordinality where value->>'mode'='count'
 ), remaining as (
   select value item, ordinality+jsonb_array_length(preferred) position
   from jsonb_array_elements(other_items) with ordinality
   where value->>'mode'='count' and not exists(
     select 1 from preferred_counts p where p.item->>'id'=value->>'id'
       or (lower(trim(p.item->>'title'))=lower(trim(value->>'title')) and lower(trim(p.item->>'room'))=lower(trim(value->>'room')))
   )
 ) select coalesce(jsonb_agg(item order by position),'[]') from (select * from preferred_counts union all select * from remaining) items
$$;
create function public.with_shared_counts(local_items jsonb, shared_items jsonb)
returns jsonb language sql immutable set search_path=public as $$
 select shared_items || coalesce(jsonb_agg(value order by ordinality),'[]')
 from jsonb_array_elements(local_items) with ordinality where value->>'mode'<>'count'
$$;
revoke all on function public.shared_count_items(jsonb,jsonb),public.with_shared_counts(jsonb,jsonb) from public,anon,authenticated;

-- Reconcilia templates já cadastrados, identificando a autoria automática como Sistema.
do $$
declare u record; checkin checklist_template_versions; checkout checklist_template_versions;
  shared jsonb; merged jsonb; template checklist_template_versions; k text; next_version integer; new_id uuid;
begin
 for u in select distinct units.id,units.property_id from units join checklist_template_versions t on t.unit_id=units.id loop
   select * into checkin from checklist_template_versions where unit_id=u.id and kind='cleaning' order by version desc limit 1;
   select * into checkout from checklist_template_versions where unit_id=u.id and kind='inspection' order by version desc limit 1;
   shared:=shared_count_items(coalesce(checkin.items,'[]'),coalesce(checkout.items,'[]'));
   if jsonb_array_length(shared)=0 then continue; end if;
   foreach k in array array['inspection','cleaning'] loop
     if k='inspection' then template:=checkout; else template:=checkin; end if;
     merged:=with_shared_counts(coalesce(template.items,'[]'),shared);
     if template.id is not null and merged=template.items then continue; end if;
     next_version:=coalesce(template.version,0)+1;
     insert into checklist_template_versions(unit_id,kind,version,items,published_by,publication_source)
       values(u.id,k,next_version,merged,null,'migration') returning id into new_id;
     insert into audit_events(property_id,actor,actor_roles,resource_id,event,before_data,after_data,reason)
       values(u.property_id,null,array['system'],new_id,'checklist.items_reconciled',to_jsonb(template),
         jsonb_build_object('version',next_version,'kind',k,'items',merged),'Migração 202610140005: itens com quantidade compartilhados');
   end loop;
 end loop;
end $$;

-- A implementação anterior continua privada para configurações que não são checklists.
alter function public.configure(text,jsonb) rename to configure_legacy;
revoke all on function public.configure_legacy(text,jsonb) from public,anon,authenticated;

create function public.publish_checklist(payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare u units; current_template checklist_template_versions; paired checklist_template_versions;
  selected_kind text; other_kind text; shared jsonb; merged jsonb; incoming jsonb; i jsonb; result uuid;
begin
 select * into u from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 selected_kind:=payload->>'kind';
 if selected_kind not in('cleaning','inspection') or selected_kind is null then raise exception 'Tipo de checklist inválido'; end if;
 other_kind:=case selected_kind when 'cleaning' then 'inspection' else 'cleaning' end;
 select * into current_template from checklist_template_versions where unit_id=u.id and kind=selected_kind order by version desc limit 1;
 if current_template.id is distinct from nullif(payload->>'base_template_id','')::uuid then
   raise exception 'CONFLICT: checklist alterado por outra pessoa. Reabra a edição para usar a versão atual.';
 end if;
 incoming:=payload->'items';
 if jsonb_typeof(incoming) is distinct from 'array' or jsonb_array_length(incoming)=0 then raise exception 'Adicione pelo menos um item ou tarefa'; end if;
 for i in select value from jsonb_array_elements(incoming) loop
   if length(trim(coalesce(i->>'title','')))=0 or length(trim(coalesce(i->>'room','')))=0 then raise exception 'Informe o nome e o ambiente de cada item'; end if;
   if i->>'mode'='count' then
     if coalesce(i->>'expected','') !~ '^[0-9]{1,4}$' then raise exception 'A quantidade deve ser um inteiro entre 0 e 9999'; end if;
     if i ? 'quantity_per_guest' and coalesce(i->>'quantity_per_guest','') !~ '^[0-9]{1,4}$' then raise exception 'Quantidade por hóspede inválida'; end if;
   end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(incoming) entry where entry->>'mode'='count'
   group by lower(trim(entry->>'title')),lower(trim(entry->>'room')) having count(*)>1) then raise exception 'Há itens com o mesmo nome no mesmo ambiente'; end if;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into shared
   from jsonb_array_elements(incoming) with ordinality where value->>'mode'='count';
 select * into paired from checklist_template_versions where unit_id=u.id and checklist_template_versions.kind=other_kind order by version desc limit 1;
 merged:=with_shared_counts(coalesce(paired.items,'[]'),shared);
 if paired.id is not null and jsonb_array_length(merged)=0 then
   raise exception 'O checklist vinculado ficaria vazio. Mantenha ao menos um item compartilhado ou uma tarefa nele.';
 end if;
 result:=configure_legacy('template',payload);
 if jsonb_array_length(merged)>0 and (paired.id is null or merged<>paired.items) then
   perform configure_legacy('template',jsonb_build_object('unit_id',u.id,'kind',other_kind,'items',merged));
 end if;
 perform audit(u.property_id,result,'checklist.published',to_jsonb(current_template),
   jsonb_build_object('items',incoming,'shared_items',shared,'paired_kind',other_kind));
 return result;
end $$;
revoke all on function public.publish_checklist(jsonb) from public,anon,authenticated;

-- Endpoint novo: clientes antigos não podem simular uma sincronização sem esta migração.
create function public.save_checklist(payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin return publish_checklist(payload); end $$;
revoke all on function public.save_checklist(jsonb) from public,anon,authenticated;
grant execute on function public.save_checklist(jsonb) to authenticated;

create function public.configure(action text,payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin
 if action='template' then return publish_checklist(payload); end if;
 return configure_legacy(action,payload);
end $$;
revoke all on function public.configure(text,jsonb) from public,anon,authenticated;
grant execute on function public.configure(text,jsonb) to authenticated;

-- A vistoria confere o padrão da estadia encerrada, e a preparação considera a próxima.
create or replace function public.confirm_checkout(payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare u units; st uuid; c uuid; t checklist_template_versions; k text; items jsonb;
  person uuid; a uuid; occ integer; previous_occupancy integer; next_occupancy integer; activity_occupancy integer;
begin
 select * into u from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 st:=(payload->>'event_id')::uuid;
 select id into c from preparation_cycles where stay_id=st; if c is not null then return c; end if;
 if exists(select 1 from activities where unit_id=u.id and status not in('completed','cancelled')) then raise exception 'A unidade já possui preparação em aberto'; end if;
 previous_occupancy:=(payload->>'guests')::integer;
 select guests into next_occupancy from reservations where unit_id=u.id and checkin>=(payload->>'checkout')::date order by checkin limit 1;
 occ:=coalesce((payload->>'occupancy')::integer,next_occupancy,u.base_occupancy);
 if occ is null or previous_occupancy is null or occ<1 or occ>u.capacity or previous_occupancy<1 or previous_occupancy>u.capacity then raise exception 'Ocupação inválida'; end if;
 if occ<>coalesce(next_occupancy,u.base_occupancy) and length(trim(coalesce(payload->>'reason','')))<5 then raise exception 'Justifique a exceção de ocupação'; end if;
 insert into stays(id,unit_id,guest_name,guests,checkin,checkout) values(st,u.id,payload->>'guest_name',previous_occupancy,(payload->>'checkin')::date,(payload->>'checkout')::date);
 insert into preparation_cycles(stay_id,unit_id,occupancy,occupancy_source) values(st,u.id,occ,case when occ<>coalesce(next_occupancy,u.base_occupancy) then 'override' when next_occupancy is not null then 'reservation' else 'base' end) returning id into c;
 foreach k in array array['inspection','cleaning'] loop
   select * into t from checklist_template_versions where unit_id=u.id and kind=k order by version desc limit 1;
   if t.id is null then raise exception 'Publique os dois tipos de checklist antes de confirmar o checkout'; end if;
   person:=(payload->>case when k='inspection' then 'inspector' else 'cleaner' end)::uuid;
   if not assignee_allowed(u.id,person,k) then raise exception 'Responsável sem função ou acesso à unidade'; end if;
   activity_occupancy:=case when k='inspection' then previous_occupancy else occ end;
   items:=applicable_items(t.items,activity_occupancy);
   if jsonb_array_length(items)=0 then raise exception 'Nenhuma tarefa aplicável à ocupação'; end if;
   insert into activities(unit_id,cycle_id,kind,title,assignee,due_at,occupancy,template_id,items)
     values(u.id,c,k,case k when 'inspection' then 'Vistoria de checkout' else 'Limpeza, arrumação e check-in' end,person,(payload->>'due_at')::timestamptz,activity_occupancy,t.id,items) returning id into a;
   perform notify(person,a,'Nova atividade atribuída',u.name||' · '||case k when 'inspection' then 'Vistoria de checkout' else 'Limpeza, arrumação e check-in' end);
 end loop;
 update units set operational_status='preparing' where id=u.id;
 perform audit(u.property_id,c,'checkout.confirmed',null,payload-'guest_name',payload->>'reason'); return c;
end $$;

notify pgrst, 'reload schema';
