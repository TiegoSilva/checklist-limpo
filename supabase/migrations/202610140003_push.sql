create table public.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles,endpoint text not null unique,keys jsonb not null,active boolean not null default true,created_at timestamptz not null default now());
alter table public.push_subscriptions enable row level security;
create policy push_read on public.push_subscriptions for select to authenticated using(user_id=auth.uid());
grant select on public.push_subscriptions to authenticated;
create table public.notification_deliveries(id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.notifications,subscription_id uuid not null references public.push_subscriptions,state text not null check(state in('delivered','failed')),attempted_at timestamptz not null default now(),error text,unique(notification_id,subscription_id));
alter table public.notification_deliveries enable row level security;
alter table public.event_outbox drop constraint event_outbox_state_check;
alter table public.event_outbox add constraint event_outbox_state_check check(state in('pending','processing','delivered','failed'));
alter table public.event_outbox add column leased_until timestamptz;
create function public.subscribe_push(subscription jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=auth.uid() and active) then raise exception 'Autenticação necessária'; end if;
 if length(subscription->>'endpoint')>2048 or coalesce(subscription->>'endpoint','') !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)/' then raise exception 'Provedor push não permitido'; end if;
 if coalesce(subscription->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{16,128}={0,2}$' or coalesce(subscription->'keys'->>'p256dh','') !~ '^[A-Za-z0-9_-]{80,200}={0,2}$' then raise exception 'Chaves push inválidas'; end if;
 if (select count(*) from push_subscriptions where user_id=auth.uid() and active)>=10 and not exists(select 1 from push_subscriptions where endpoint=subscription->>'endpoint' and user_id=auth.uid()) then raise exception 'Limite de dispositivos atingido'; end if;
 insert into push_subscriptions(user_id,endpoint,keys) values(auth.uid(),subscription->>'endpoint',subscription->'keys') on conflict(endpoint) do update set user_id=excluded.user_id,keys=excluded.keys,active=true;
end $$;
create function public.unsubscribe_push(endpoint_url text) returns void language plpgsql security definer set search_path=public as $$begin update push_subscriptions set active=false where user_id=auth.uid() and endpoint=endpoint_url; end$$;
-- A fila é reivindicada atomicamente; concessão temporária recupera execuções interrompidas.
create function public.claim_outbox(batch_size integer default 20) returns setof public.event_outbox language plpgsql security definer set search_path=public as $$
begin
 update event_outbox set state='failed',last_error='Limite de tentativas atingido após expiração da concessão',leased_until=null where state='processing' and leased_until<now() and attempts>=8;
 return query update event_outbox set state='processing',attempts=attempts+1,leased_until=now()+interval '2 minutes' where id in(select id from event_outbox where ((state='pending' and next_attempt_at<=now()) or (state='processing' and leased_until<now())) and attempts<8 order by created_at for update skip locked limit least(greatest(batch_size,1),20)) returning *;
end $$;
create function public.finish_outbox(event_id uuid, failure text default null) returns void language plpgsql security definer set search_path=public as $$begin
 update event_outbox set state=case when failure is null then 'delivered' when attempts>=8 then 'failed' else 'pending' end,last_error=failure,next_attempt_at=now()+interval '1 minute'*power(2,least(attempts,8)),leased_until=null where id=event_id and state='processing';
end $$;
revoke all on function public.subscribe_push(jsonb),public.unsubscribe_push(text),public.claim_outbox(integer),public.finish_outbox(uuid,text) from public,anon,authenticated;
grant execute on function public.subscribe_push(jsonb),public.unsubscribe_push(text) to authenticated;
grant execute on function public.claim_outbox(integer),public.finish_outbox(uuid,text) to service_role;
grant all on public.push_subscriptions,public.notification_deliveries,public.event_outbox to service_role;
