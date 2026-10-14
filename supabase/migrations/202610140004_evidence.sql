-- A API verifica os bytes e calcula o SHA-256. O cliente não certifica o próprio hash.
revoke execute on function public.register_evidence(uuid,text,uuid,text) from authenticated;
create function public.receive_evidence(actor uuid, activity uuid, item text, file_id uuid, hash text) returns void language plpgsql security definer set search_path=public as $$
begin
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform register_evidence(activity,item,file_id,hash);
end $$;
revoke all on function public.receive_evidence(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.receive_evidence(uuid,uuid,text,uuid,text) to service_role;

create table public.service_evidence(id uuid primary key default gen_random_uuid(),service_id uuid not null references public.service_orders,uploader uuid not null references public.profiles,path text not null unique,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),received_at timestamptz not null default now());
alter table public.service_evidence enable row level security;
create policy service_evidence_read on public.service_evidence for select to authenticated using(exists(select 1 from service_orders s where s.id=service_id and (s.assignee=auth.uid() or can_unit(s.unit_id,true)) and can_unit(s.unit_id)));
grant select on public.service_evidence to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('service-evidence','service-evidence',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy service_photo_upload on storage.objects for insert to authenticated with check(bucket_id='service-evidence' and exists(select 1 from service_orders s where s.id::text=(storage.foldername(name))[1] and s.assignee=auth.uid() and s.status='in_progress' and can_unit(s.unit_id)));
create policy service_photo_download on storage.objects for select to authenticated using(bucket_id='service-evidence' and exists(select 1 from service_evidence e join service_orders s on s.id=e.service_id where e.path=name and can_unit(s.unit_id) and (s.assignee=auth.uid() or can_unit(s.unit_id,true))));
create function public.receive_service_evidence(actor uuid, service uuid, file_id uuid, hash text) returns void language plpgsql security definer set search_path=public as $$
declare s service_orders; path text; p uuid; begin
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select * into s from service_orders where id=service for update;
 if s.assignee<>auth.uid() or s.status<>'in_progress' or not coalesce(can_unit(s.unit_id),false) then raise exception 'Evidência não permitida'; end if;
 path:=service::text||'/'||file_id::text;
 if not exists(select 1 from storage.objects where bucket_id='service-evidence' and name=path) then raise exception 'Envie primeiro o arquivo'; end if;
 insert into service_evidence(id,service_id,uploader,path,sha256) values(file_id,service,auth.uid(),path,hash);
 select property_id into p from units where id=s.unit_id;perform audit(p,service,'service.evidence',null,jsonb_build_object('file_id',file_id,'sha256',hash));
end $$;
revoke all on function public.receive_service_evidence(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.receive_service_evidence(uuid,uuid,uuid,text) to service_role;
-- Trigger protege o fluxo de serviço, inclusive chamadas diretas à RPC.
create function public.require_service_evidence() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.status='review' and old.status<>new.status and not exists(select 1 from service_evidence where service_id=new.id and received_at>=coalesce((select max(created_at) from audit_events where resource_id=new.id and event='service.reject'),'epoch'::timestamptz)) then raise exception 'Anexe uma fotografia como evidência da conclusão'; end if;
 return new;
end $$;
create trigger service_submission_evidence before update on public.service_orders for each row execute function public.require_service_evidence();
revoke all on function public.require_service_evidence() from public,anon,authenticated;
