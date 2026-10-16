-- A propriedade do item é sempre derivada de units.property_id.
-- Manter uma única chave evita vínculos divergentes entre propriedade e unidade.
alter table public.inventory_items add column revision integer not null default 0 check(revision>=0);
create index if not exists inventory_items_unit on public.inventory_items(unit_id);

create function public.save_inventory_item(payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  current_item inventory_items;
  saved inventory_items;
  destination units;
  source_property uuid;
  item_id uuid := nullif(payload->>'id','')::uuid;
  item_name text := trim(coalesce(payload->>'name',''));
  item_room text := coalesce(nullif(trim(payload->>'room'),''),'Geral');
  item_category text := coalesce(payload->>'category','permanent');
  item_quantity numeric;
begin
  select * into destination from units where id=(payload->>'unit_id')::uuid;
  if destination.id is null or not coalesce(can_unit(destination.id,true),false) then
    raise exception 'Unidade inválida ou acesso negado';
  end if;
  if item_id is not null then
    select * into current_item from inventory_items where id=item_id for update;
    if current_item.id is null or not coalesce(can_unit(current_item.unit_id,true),false) then
      raise exception 'Item não encontrado ou acesso negado';
    end if;
    select property_id into source_property from units where id=current_item.unit_id;
    if (select org_id from properties where id=source_property) <>
       (select org_id from properties where id=destination.property_id) then
      raise exception 'O item deve permanecer na mesma organização';
    end if;
    if (payload->>'revision')::integer is distinct from current_item.revision then
      raise exception 'Este item foi alterado por outra pessoa. Feche e reabra a edição para carregar a versão atual.';
    end if;
  end if;
  if length(item_name)<1 or length(item_name)>160 then raise exception 'Informe um nome com até 160 caracteres'; end if;
  if length(item_room)>100 then raise exception 'Informe um ambiente com até 100 caracteres'; end if;
  if item_category not in ('permanent','linen','consumable') then raise exception 'Categoria inválida'; end if;
  if jsonb_typeof(payload->'expected') is distinct from 'number' then raise exception 'Quantidade inválida'; end if;
  item_quantity:=(payload->>'expected')::numeric;
  if item_quantity<0 or item_quantity>9999 or item_quantity<>trunc(item_quantity) then
    raise exception 'A quantidade deve ser um número inteiro de 0 a 9999';
  end if;
  if item_id is null then
    insert into inventory_items(unit_id,name,room,category,expected)
      values(destination.id,item_name,item_room,item_category,item_quantity::integer) returning * into saved;
  else
    update inventory_items set unit_id=destination.id,name=item_name,room=item_room,
      category=item_category,expected=item_quantity::integer,revision=revision+1
      where id=item_id returning * into saved;
  end if;
  -- Uma mudança de propriedade fica visível na auditoria da origem e do destino.
  if source_property is not null and source_property<>destination.property_id then
    perform audit(source_property,saved.id,'inventory.moved',to_jsonb(current_item),to_jsonb(saved));
  end if;
  perform audit(destination.property_id,saved.id,
    case when item_id is null then 'inventory.created' else 'inventory.updated' end,
    case when item_id is null then null else to_jsonb(current_item) end,to_jsonb(saved));
  return saved.id;
end $$;
revoke all on function public.save_inventory_item(jsonb) from public,anon,authenticated;
grant execute on function public.save_inventory_item(jsonb) to authenticated;

-- Mantém os clientes antigos sob as mesmas validações de vínculo e escopo.
create or replace function public.configure(action text,payload jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin
  if action='template' then return publish_checklist(payload); end if;
  if action='inventory' then return save_inventory_item(payload); end if;
  return configure_legacy(action,payload);
end $$;
notify pgrst,'reload schema';
