create table public.reservations(id uuid primary key,unit_id uuid not null references public.units,guest_name text not null,guests integer not null check(guests>0),checkin date not null,checkout date not null check(checkout>=checkin),created_at timestamptz not null default now());
alter table public.reservations enable row level security;
create policy reservation_read on public.reservations for select to authenticated using(can_unit(unit_id,true));
grant select on public.reservations to authenticated;
create function public.applicable_items(items jsonb, occupancy integer) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(case when value ? 'quantity_per_guest' then value||jsonb_build_object('expected',(value->>'quantity_per_guest')::integer*occupancy) else value end),'[]') from jsonb_array_elements(items) where coalesce((value->>'min_guests')::integer,1)<=occupancy and coalesce((value->>'max_guests')::integer,999)>=occupancy
$$;
-- Reserva confirmada depois da liberação gera somente diferenças da preparação.
create function public.confirm_reservation(payload jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare u units; a activities; t checklist_template_versions; target jsonb; delta jsonb; result uuid; item jsonb; occ integer; event_id uuid; begin
 select * into u from units where id=(payload->>'unit_id')::uuid for update;
 if not coalesce(can_unit(u.id,true),false) then raise exception 'Acesso negado'; end if;
 event_id:=(payload->>'event_id')::uuid;
 if exists(select 1 from reservations where id=event_id) then return null; end if;
 occ:=(payload->>'guests')::integer;
 if occ<1 or occ>u.capacity then raise exception 'Ocupação inválida'; end if;
 insert into reservations(id,unit_id,guest_name,guests,checkin,checkout) values(event_id,u.id,payload->>'guest_name',occ,(payload->>'checkin')::date,(payload->>'checkout')::date);
 if u.operational_status='ready' and u.prepared_for<>occ then
 select * into a from activities where unit_id=u.id and approved_at is not null order by approved_at desc limit 1;
 select * into t from checklist_template_versions where unit_id=u.id and kind='cleaning' order by version desc limit 1;
 if a.id is null or t.id is null then raise exception 'Preparação aprovada não localizada'; end if;
 if not assignee_allowed(u.id,(payload->>'assignee')::uuid,'cleaning') then raise exception 'Responsável sem função ou acesso'; end if;
 target:=applicable_items(t.items,occ);
 select coalesce(jsonb_agg(i),'[]') into delta from jsonb_array_elements(target) i where not exists(select 1 from jsonb_array_elements(a.items) prev where prev->>'id'=i->>'id' and prev= i);
 -- Quando uma tarefa deixa de se aplicar, exigir conferência explícita da retirada.
 for item in select prev from jsonb_array_elements(a.items) prev where not exists(select 1 from jsonb_array_elements(target) i where i->>'id'=prev->>'id') loop
 delta:=delta||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'room',item->>'room','title','Adequar ocupação: retirar preparação de '||(item->>'title'),'mode','technical','required',true,'evidence_required',true));
 end loop;
 if jsonb_array_length(delta)>0 then
 insert into activities(unit_id,cycle_id,kind,title,assignee,due_at,occupancy,template_id,items) values(u.id,a.cycle_id,'complement','Preparação complementar',(payload->>'assignee')::uuid,(payload->>'due_at')::timestamptz,occ,t.id,delta) returning id into result;
 update units set operational_status='adjustment' where id=u.id;
 perform notify((payload->>'assignee')::uuid,result,'Preparação complementar atribuída',u.name||' · Preparar para '||occ||' hóspedes');
 else update units set prepared_for=occ where id=u.id;
 end if;
 elsif u.operational_status='ready' and u.prepared_for=occ then null;
 elsif exists(select 1 from activities where unit_id=u.id and kind<>'inspection' and status not in('completed','cancelled') and occupancy<>occ) then
 raise exception 'Há preparação em aberto para outra ocupação. Ajuste a programação antes de confirmar a reserva.';
 end if;
 perform audit(u.property_id,event_id,'reservation.confirmed',null,payload-'guest_name');return result;
end $$;
revoke all on function public.applicable_items(jsonb,integer),public.confirm_reservation(jsonb) from public,anon,authenticated;
grant execute on function public.confirm_reservation(jsonb) to authenticated;

-- Permissões e desativação preservam usuários e todo o histórico.
create function public.set_member_active(organization uuid, person uuid, enabled boolean, reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not org_role(organization,array['admin']) or length(trim(reason))<5 then raise exception 'Administrador e justificativa obrigatórios'; end if;
 if person=auth.uid() or not exists(select 1 from memberships where org_id=organization and user_id=person) then raise exception 'Usuário inválido ou tentativa de desativar a própria conta'; end if;
 -- O perfil é global: não permitir que uma organização desative membro de outra.
 if exists(select 1 from memberships where user_id=person and org_id<>organization) then raise exception 'Usuário vinculado a outras organizações; remova somente seus acessos'; end if;
 if not enabled and exists(select 1 from activities where assignee=person and status not in('completed','cancelled')) then raise exception 'Reatribua as atividades antes de desativar'; end if;
 update profiles set active=enabled where id=person;
 insert into audit_events(actor,actor_roles,resource_id,event,after_data,reason) select auth.uid(),roles,person,'member.active_changed',jsonb_build_object('active',enabled),reason from memberships where org_id=organization and user_id=auth.uid();
end $$;
revoke all on function public.set_member_active(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.set_member_active(uuid,uuid,boolean,text) to authenticated;
