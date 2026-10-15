-- Modelos independentes com nomes próprios. Versões e execuções anteriores preservadas.
alter table public.checklist_template_versions add column model_id uuid,
 add column name text, add column legacy_series boolean not null default true;
update public.checklist_template_versions t set model_id=(select v.id from public.checklist_template_versions v where v.unit_id=t.unit_id and v.kind=t.kind order by version limit 1),
 name=case kind when 'inspection' then 'Vistoria de checkout' else 'Limpeza, arrumação e check-in' end;
create function public.identify_checklist_model() returns trigger language plpgsql security definer set search_path=public as $$
declare previous checklist_template_versions; begin
 if new.model_id is null then
   select * into previous from checklist_template_versions where unit_id=new.unit_id and kind=new.kind and legacy_series order by version desc limit 1;
   new.model_id:=coalesce(previous.model_id,gen_random_uuid());
   new.name:=coalesce(new.name,previous.name,case new.kind when 'inspection' then 'Vistoria de checkout' else 'Limpeza, arrumação e check-in' end);
 end if;
 return new;
end $$;
create trigger identify_checklist_model before insert on public.checklist_template_versions for each row execute function public.identify_checklist_model();
alter table public.checklist_template_versions alter column model_id set not null,
 alter column name set not null, add constraint checklist_name_length check(length(trim(name)) between 1 and 100);
create index checklist_model_versions on public.checklist_template_versions(model_id,version desc);
revoke all on function public.identify_checklist_model() from public,anon,authenticated;

create function public.validate_checklist_items(incoming jsonb) returns void language plpgsql set search_path=public as $$
declare i jsonb; begin
 if jsonb_typeof(incoming) is distinct from 'array' or jsonb_array_length(incoming)=0 then raise exception 'Adicione pelo menos um item ou tarefa'; end if;
 for i in select value from jsonb_array_elements(incoming) loop
   if coalesce(i->>'id','')='' or length(trim(coalesce(i->>'title','')))=0 or length(trim(coalesce(i->>'room','')))=0 or coalesce(i->>'mode','') not in('task','technical','count') then raise exception 'Item de checklist inválido: informe nome, ambiente e resposta'; end if;
   if i->>'mode'='count' then
     if coalesce(i->>'expected','') !~ '^[0-9]{1,4}$' then raise exception 'A quantidade deve ser um inteiro entre 0 e 9999'; end if;
     if i ? 'quantity_per_guest' and coalesce(i->>'quantity_per_guest','') !~ '^[0-9]{1,4}$' then raise exception 'Quantidade por hóspede inválida'; end if;
   end if;
   if coalesce((i->>'min_guests')::integer,1)>coalesce((i->>'max_guests')::integer,9999) then raise exception 'Faixa de ocupação inválida'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(incoming))<>(select count(distinct value->>'id') from jsonb_array_elements(incoming)) then raise exception 'IDs duplicados'; end if;
 if exists(select 1 from jsonb_array_elements(incoming) entry where entry->>'mode'='count' group by lower(trim(entry->>'title')),lower(trim(entry->>'room')) having count(*)>1) then raise exception 'Há itens com o mesmo nome no mesmo ambiente'; end if;
end $$;
revoke all on function public.validate_checklist_items(jsonb) from public,anon,authenticated;

create function public.save_named_checklist(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare u units; base checklist_template_versions; current_id uuid; source checklist_template_versions; model uuid; result uuid; v integer;
 label text; selected_kind text; incoming jsonb; begin
 select * into u from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 label:=trim(coalesce(payload->>'name',''));
 if length(label) not between 1 and 100 then raise exception 'Informe um nome de até 100 caracteres'; end if;
 selected_kind:=coalesce(payload->>'kind','cleaning');
 if selected_kind not in('cleaning','inspection') then raise exception 'Tipo de checklist inválido'; end if;
 if nullif(payload->>'base_template_id','') is not null then
   select * into base from checklist_template_versions where id=(payload->>'base_template_id')::uuid and unit_id=u.id and kind=selected_kind;
   if base.id is null then raise exception 'Modelo incompatível com a unidade'; end if;
   select id into current_id from checklist_template_versions where model_id=base.model_id order by version desc limit 1;
   if current_id<>base.id then raise exception 'CONFLICT: o modelo foi alterado. Reabra a edição'; end if;
   if base.archived_at is not null then raise exception 'Modelo removido. Restaure-o antes de editar'; end if;
   model:=base.model_id;
 else model:=gen_random_uuid(); end if;
 if nullif(payload->>'source_template_id','') is not null then
   if base.id is not null then raise exception 'Uma cópia deve criar um novo modelo'; end if;
   select * into source from checklist_template_versions where id=(payload->>'source_template_id')::uuid;
   if source.id is null or not coalesce(can_unit(source.unit_id,true),false) then raise exception 'Acesso negado ao modelo de origem'; end if;
   if source.archived_at is not null then raise exception 'O modelo de origem foi removido'; end if;
 end if;
 if exists(select 1 from checklist_template_versions t where t.unit_id=u.id and t.model_id<>model and lower(trim(t.name))=lower(label) and t.archived_at is null and t.version=(select max(x.version) from checklist_template_versions x where x.model_id=t.model_id)) then raise exception 'Já existe um modelo com este nome na unidade'; end if;
 incoming:=payload->'items';
 perform validate_checklist_items(incoming);
 if exists(select 1 from jsonb_array_elements(incoming) i where nullif(i->>'reference_path','') is not null and split_part(i->>'reference_path','/',1)<>u.id::text) then raise exception 'Copie as fotos de referência para a unidade de destino antes de salvar'; end if;
 -- Numeração mantida por unidade e tipo para compatibilidade com clientes antigos.
 select coalesce(max(version),0)+1 into v from checklist_template_versions where unit_id=u.id and kind=selected_kind;
 insert into checklist_template_versions(unit_id,kind,version,items,published_by,model_id,name,legacy_series)
 values(u.id,selected_kind,v,incoming,auth.uid(),model,label,coalesce(base.legacy_series,false)) returning id into result;
 perform audit(u.property_id,result,case when source.id is not null then 'checklist.duplicated' else 'checklist.published' end,to_jsonb(base),jsonb_build_object('model_id',model,'name',label,'source_template_id',source.id,'items',incoming));
 return result;
end $$;
revoke all on function public.save_named_checklist(jsonb) from public,anon,authenticated;
grant execute on function public.save_named_checklist(jsonb) to authenticated;

-- Arquivar ou restaurar somente o modelo escolhido, sem afetar os demais da unidade.
create or replace function public.set_checklist_archived(template uuid,archived boolean) returns void language plpgsql security definer set search_path=public as $$
declare t checklist_template_versions; current_id uuid; p uuid; begin
 select * into t from checklist_template_versions where id=template;
 perform 1 from units where id=t.unit_id for update;
 if not coalesce(can_unit(t.unit_id,true),false) then raise exception 'Acesso negado'; end if;
 select id into current_id from checklist_template_versions where model_id=t.model_id order by version desc limit 1;
 if current_id<>template then raise exception 'CONFLICT: o modelo mudou. Atualize a lista antes de remover ou restaurar'; end if;
 if archived is null then raise exception 'Informe a situação do modelo'; end if;
 update checklist_template_versions set archived_at=case when archived then now() end,archived_by=case when archived then auth.uid() end where model_id=t.model_id;
 select property_id into p from units where id=t.unit_id;
 perform audit(p,template,case when archived then 'checklist.archived' else 'checklist.restored' end,to_jsonb(t),jsonb_build_object('archived',archived));
end $$;

-- Compatibilidade: sincronização antiga atua apenas nas duas séries antigas.
create or replace function public.publish_checklist(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare u units; t checklist_template_versions; paired checklist_template_versions; base checklist_template_versions; result uuid; k text; other_kind text; incoming jsonb; shared jsonb; merged jsonb; begin
 select * into u from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 select * into base from checklist_template_versions where id=nullif(payload->>'base_template_id','')::uuid;
 if base.id is not null and not base.legacy_series then
   return save_named_checklist(payload||jsonb_build_object('name',coalesce(payload->>'name',base.name)));
 end if;
 k:=payload->>'kind'; other_kind:=case k when 'cleaning' then 'inspection' else 'cleaning' end;
 if k is null or k not in('cleaning','inspection') then raise exception 'Tipo de checklist inválido'; end if;
 select * into t from checklist_template_versions where unit_id=u.id and kind=k and legacy_series order by version desc limit 1;
 if t.archived_at is not null then
   if nullif(payload->>'base_template_id','') is not null then raise exception 'Modelo removido. Restaure-o antes de editar'; end if;
   payload:=payload||jsonb_build_object('base_template_id',t.id);
 end if;
 if t.id is distinct from nullif(payload->>'base_template_id','')::uuid then raise exception 'CONFLICT: checklist alterado por outra pessoa. Reabra a edição para usar a versão atual.'; end if;
 incoming:=payload->'items'; perform validate_checklist_items(incoming);
 select coalesce(jsonb_agg(value order by ordinality),'[]') into shared from jsonb_array_elements(incoming) with ordinality where value->>'mode'='count';
 select * into paired from checklist_template_versions where unit_id=u.id and kind=other_kind and legacy_series order by version desc limit 1;
 merged:=with_shared_counts(coalesce(paired.items,'[]'),shared);
 if paired.id is not null and jsonb_array_length(merged)=0 then raise exception 'O checklist vinculado ficaria vazio. Mantenha ao menos um item compartilhado ou uma tarefa nele.'; end if;
 result:=configure_legacy('template',payload);
 if jsonb_array_length(merged)>0 and (paired.id is null or merged<>paired.items) then perform configure_legacy('template',jsonb_build_object('unit_id',u.id,'kind',other_kind,'items',merged)); end if;
 if paired.archived_at is not null then update checklist_template_versions set archived_at=paired.archived_at,archived_by=paired.archived_by where model_id=paired.model_id; end if;
 perform audit(u.property_id,result,'checklist.published',to_jsonb(t),jsonb_build_object('items',incoming,'shared_items',shared,'paired_kind',other_kind));
 return result;
end $$;
notify pgrst,'reload schema';
