-- Remoção recuperável do modelo: versões e execuções permanecem intactas.
alter table public.checklist_template_versions add column archived_at timestamptz,
 add column archived_by uuid references public.profiles;

create function public.set_checklist_archived(template uuid,archived boolean) returns void language plpgsql security definer set search_path=public as $$
declare t checklist_template_versions; current_id uuid; p uuid; begin
 select * into t from checklist_template_versions where id=template;
 perform 1 from units where id=t.unit_id for update;
 if not coalesce(can_unit(t.unit_id,true),false) then raise exception 'Acesso negado'; end if;
 select id into current_id from checklist_template_versions where unit_id=t.unit_id and kind=t.kind order by version desc limit 1;
 if current_id<>template then raise exception 'CONFLICT: o modelo mudou. Atualize a lista antes de remover ou restaurar'; end if;
 if archived is null then raise exception 'Informe a situação do modelo'; end if;
 update checklist_template_versions set archived_at=case when archived then now() end,archived_by=case when archived then auth.uid() end where unit_id=t.unit_id and kind=t.kind;
 select property_id into p from units where id=t.unit_id;
 perform audit(p,template,case when archived then 'checklist.archived' else 'checklist.restored' end,to_jsonb(t),jsonb_build_object('archived',archived));
end $$;
revoke all on function public.set_checklist_archived(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_checklist_archived(uuid,boolean) to authenticated;

-- Aplica a regra a todas as formas de criar execuções, inclusive clientes antigos.
create function public.require_active_template() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from checklist_template_versions where id=new.template_id and archived_at is not null) then raise exception 'Este modelo foi removido. Escolha um modelo ativo ou restaure-o'; end if;
 return new;
end $$;
create trigger active_template_before_execution before insert on public.activities for each row execute function public.require_active_template();
revoke all on function public.require_active_template() from public,anon,authenticated;

alter function public.publish_checklist(jsonb) rename to publish_checklist_before_archive;
revoke all on function public.publish_checklist_before_archive(jsonb) from public,anon,authenticated;
create function public.publish_checklist(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare t checklist_template_versions; paired checklist_template_versions; result uuid; begin
 perform 1 from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit((payload->>'unit_id')::uuid,true),false) then raise exception 'Acesso negado'; end if;
 select * into t from checklist_template_versions where unit_id=(payload->>'unit_id')::uuid and kind=payload->>'kind' order by version desc limit 1;
 select * into paired from checklist_template_versions where unit_id=(payload->>'unit_id')::uuid and kind<>payload->>'kind' order by version desc limit 1;
 if t.archived_at is not null then
   if nullif(payload->>'base_template_id','') is not null then raise exception 'Modelo removido. Restaure-o antes de editar'; end if;
   payload:=payload||jsonb_build_object('base_template_id',t.id);
 end if;
 result:=publish_checklist_before_archive(payload);
 -- Sincronizar itens não deve restaurar implicitamente o outro modelo removido.
 if paired.archived_at is not null then
   update checklist_template_versions set archived_at=paired.archived_at,archived_by=paired.archived_by where unit_id=paired.unit_id and kind=paired.kind;
 end if;
 return result;
end $$;
revoke all on function public.publish_checklist(jsonb) from public,anon,authenticated;
create or replace function public.save_checklist(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
begin return publish_checklist(payload); end $$;
create or replace function public.configure(action text,payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
begin
 if action='template' then return publish_checklist(payload); end if;
 return configure_legacy(action,payload);
end $$;
notify pgrst,'reload schema';
