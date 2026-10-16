-- Evidências privadas de foto ou vídeo. Aplicar depois da migração 012.
alter table public.evidence_files add column mime_type text not null default 'image/jpeg', add column file_size bigint check(file_size>0);
alter table public.service_evidence add column mime_type text not null default 'image/jpeg', add column file_size bigint check(file_size>0);
update storage.buckets set file_size_limit=52428800,allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'] where id in('evidence','service-evidence');

create function public.receive_media_evidence(actor uuid,resource uuid,kind text,item text,file_id uuid,hash text,media_type text,bytes bigint) returns void language plpgsql security definer set search_path=public as $$
begin
 if media_type not in('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm') or media_type is null or bytes is null or bytes<=0 or bytes>(case when media_type like 'video/%' then 52428800 else 10485760 end) then raise exception 'Tipo ou tamanho de evidência inválido'; end if;
 if kind='activity' then
   if exists(select 1 from evidence_files where id=file_id and (activity_id<>resource or uploader<>actor or sha256<>hash)) then raise exception 'Evidência incompatível'; end if;
   perform receive_evidence(actor,resource,coalesce(item,'__activity__'),file_id,hash);
   update evidence_files set mime_type=media_type,file_size=bytes where id=file_id and activity_id=resource and uploader=actor;
 elsif kind='service' then
   if exists(select 1 from service_evidence where id=file_id) then
     if not exists(select 1 from service_evidence where id=file_id and service_id=resource and uploader=actor and sha256=hash) then raise exception 'Evidência incompatível'; end if;
   else perform receive_service_evidence(actor,resource,file_id,hash); end if;
   update service_evidence set mime_type=media_type,file_size=bytes where id=file_id and service_id=resource and uploader=actor;
 else raise exception 'Recurso inválido'; end if;
end $$;
revoke all on function public.receive_media_evidence(uuid,uuid,text,text,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.receive_media_evidence(uuid,uuid,text,text,uuid,text,text,bigint) to service_role;

do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.validate_submission(public.activities)'::regprocedure);
 execute replace(definition,'Adicione ao menos uma foto no campo Fotos da vistoria','Adicione ao menos uma foto ou vídeo no campo Evidências da vistoria');
end $$;

-- A fila pode ser despertada pelas ações da aplicação, somente no servidor,
-- para destinatários das organizações do usuário e no máximo a cada 15 segundos.
create table public.push_dispatch_requests(actor uuid primary key references public.profiles,last_requested_at timestamptz not null);
alter table public.push_dispatch_requests enable row level security;
revoke all on public.push_dispatch_requests from public,anon,authenticated;
grant all on public.push_dispatch_requests to service_role;
create function public.claim_outbox_for_actor(actor uuid,batch_size integer default 20) returns setof public.event_outbox language plpgsql security definer set search_path=public as $$
declare granted uuid; begin
 if not exists(select 1 from profiles where id=actor and active) then return; end if;
 insert into push_dispatch_requests values(actor,now()) on conflict on constraint push_dispatch_requests_pkey do update set last_requested_at=excluded.last_requested_at where push_dispatch_requests.last_requested_at<now()-interval '15 seconds' returning push_dispatch_requests.actor into granted;
 if granted is null then return; end if;
 return query update event_outbox set state='processing',attempts=attempts+1,leased_until=now()+interval '2 minutes' where id in(
   select e.id from event_outbox e join notifications n on n.id=e.notification_id
   where n.read_at is null and ((e.state='pending' and e.next_attempt_at<=now()) or (e.state='processing' and e.leased_until<now())) and e.attempts<8
   and exists(select 1 from memberships recipient join memberships sender on sender.org_id=recipient.org_id where recipient.user_id=n.recipient and sender.user_id=actor)
   order by e.created_at for update of e skip locked limit least(greatest(batch_size,1),20)
 ) returning *;
end $$;
revoke all on function public.claim_outbox_for_actor(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_outbox_for_actor(uuid,integer) to service_role;
notify pgrst,'reload schema';
