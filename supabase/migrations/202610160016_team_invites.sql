-- Convites com escopo validado no banco. E-mails são enviados apenas pela API autenticada.
create table public.team_invites(id uuid primary key,org_id uuid not null references organizations,email text not null,name text not null,roles text[] not null,properties uuid[] not null,actor uuid not null references profiles,created_at timestamptz not null default now(),last_requested_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '7 days'),completed_at timestamptz,existing_account boolean not null default false);
alter table public.team_invites enable row level security;
create policy invites_read on public.team_invites for select to authenticated using(org_role(org_id,array['admin']));
grant select on public.team_invites to authenticated;
create function public.prepare_team_invite(payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare organization uuid:=(payload->>'org_id')::uuid; request uuid:=(payload->>'request_id')::uuid; invite team_invites; who uuid; requested_roles text[]; requested_properties uuid[]; email_address text:=lower(trim(payload->>'email')); begin
 if not coalesce(org_role(organization,array['admin']),false) then raise exception 'Somente administradores podem convidar ou alterar acessos'; end if;
 if email_address is null or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(email_address)>254 or length(trim(coalesce(payload->>'name','')))<2 then raise exception 'Informe nome e e-mail válidos'; end if;
 requested_roles:=array(select jsonb_array_elements_text(payload->'roles'));
 requested_properties:=array(select jsonb_array_elements_text(payload->'properties')::uuid);
 if cardinality(requested_roles)=0 or not requested_roles<@array['admin','manager','cleaner','inspector'] then raise exception 'Selecione ao menos uma função válida'; end if;
 if exists(select 1 from unnest(requested_properties) as requested(property_id) where not exists(select 1 from properties p where p.id=requested.property_id and p.org_id=organization)) then raise exception 'Selecione somente propriedades desta organização'; end if;
 select id into who from auth.users where lower(email)=email_address;
 perform pg_advisory_xact_lock(hashtext('invite:'||organization::text||email_address));
 select * into invite from team_invites where id=request for update;
 if invite.id is not null then
   if invite.actor<>auth.uid() or invite.org_id<>organization or invite.email<>email_address or invite.name<>trim(payload->>'name') or invite.roles<>requested_roles or invite.properties<>requested_properties then raise exception 'Os dados do convite mudaram. Reabra o formulário'; end if;
   if invite.expires_at<now() then raise exception 'Convite expirado. Crie outro convite'; end if;
   if invite.completed_at is not null then return jsonb_build_object('id',request,'complete',true,'email',email_address); end if;
   if invite.last_requested_at>now()-interval '60 seconds' then raise exception 'Aguarde um minuto antes de tentar reenviar o convite'; end if;
   update team_invites set last_requested_at=now() where id=request;
 else
   if (select count(*) from team_invites where actor=auth.uid() and created_at>now()-interval '1 hour')>=20 then raise exception 'Limite de 20 convites por hora. Tente mais tarde'; end if;
   insert into team_invites(id,org_id,email,name,roles,properties,actor,existing_account) values(request,organization,email_address,trim(payload->>'name'),requested_roles,requested_properties,auth.uid(),who is not null) returning * into invite;
 end if;
 select id into who from auth.users where lower(email)=email_address;
 return jsonb_build_object('id',request,'email',email_address,'existing',who is not null,'needs_link',not invite.existing_account,'complete',false);
end $$;
create function public.finish_team_invite(invitation uuid) returns void language plpgsql security definer set search_path=public as $$
declare invite team_invites; begin
 select * into invite from team_invites where id=invitation for update;
 if invite.id is null or not coalesce(org_role(invite.org_id,array['admin']),false) then raise exception 'Acesso negado'; end if;
 if invite.completed_at is not null then return; end if;
 if invite.expires_at<now() then raise exception 'Convite expirado'; end if;
 perform configure_legacy('member',jsonb_build_object('org_id',invite.org_id,'email',invite.email,'name',invite.name,'roles',to_jsonb(invite.roles),'properties',to_jsonb(invite.properties)));
 update team_invites set completed_at=now() where id=invite.id;
end $$;
revoke all on function public.prepare_team_invite(jsonb),public.finish_team_invite(uuid) from public,anon,authenticated;
grant execute on function public.prepare_team_invite(jsonb),public.finish_team_invite(uuid) to authenticated;
notify pgrst,'reload schema';
