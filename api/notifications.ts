import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';
export const config = { maxDuration: 60 };
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method ?? ''))
    return res.status(405).json({ error: 'Método não permitido' });
  const actual = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET ?? ''}`);
  const cron =
    req.method === 'GET' &&
    Boolean(process.env.CRON_SECRET) &&
    actual.length === expected.length &&
    timingSafeEqual(actual, expected);
  let actor: string | null = null;
  if (!cron) {
    if (
      req.method !== 'POST' ||
      !req.headers.authorization?.startsWith('Bearer ')
    )
      return res.status(401).json({ error: 'Não autorizado' });
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
      return res.status(503).json({ error: 'Servidor não configurado' });
    const authClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { persistSession: false } },
    );
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser(req.headers.authorization.slice(7));
    if (error || !user)
      return res.status(401).json({ error: 'Sessão inválida' });
    actor = user.id;
  }
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_SUBJECT,
  } = process.env;
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !VAPID_PUBLIC_KEY ||
    !VAPID_PRIVATE_KEY ||
    !VAPID_SUBJECT
  )
    return res
      .status(503)
      .json({ error: 'Configure Supabase e VAPID no servidor' });
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  if (actor) {
    const { data: profile } = await client
      .from('profiles')
      .select('active')
      .eq('id', actor)
      .single();
    if (!profile?.active)
      return res.status(403).json({ error: 'Perfil desativado' });
    if (req.body?.test_endpoint !== undefined) {
      if (
        typeof req.body.test_endpoint !== 'string' ||
        req.body.test_endpoint.length > 2048
      )
        return res.status(400).json({ error: 'Dispositivo inválido' });
      const { data: sub } = await client
        .from('push_subscriptions')
        .select('id,endpoint,keys')
        .eq('user_id', actor)
        .eq('endpoint', req.body.test_endpoint)
        .eq('active', true)
        .maybeSingle();
      if (!sub)
        return res
          .status(404)
          .json({
            error:
              'Este aparelho não está vinculado. Ative as notificações novamente.',
          });
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({
            tag: 'device-test',
            body: 'O aparelho recebeu o teste de notificações.',
            test: true,
          }),
          { TTL: 60, timeout: 5000 },
        );
        return res.status(200).json({ sent: true });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await client
            .from('push_subscriptions')
            .update({ active: false })
            .eq('id', sub.id);
        return res
          .status(502)
          .json({
            error:
              'O provedor não confirmou o envio. Reative as notificações e tente novamente.',
          });
      }
    }
  }
  const { data: events, error } = await client.rpc(
    actor ? 'claim_outbox_for_actor' : 'claim_outbox',
    { batch_size: 20, ...(actor ? { actor } : {}) },
  );
  if (error)
    return res
      .status(500)
      .json({ error: 'Não foi possível reivindicar a fila' });
  let processed = 0;
  for (const event of events ?? []) {
    let failure: string | null = null;
    const { data: notice, error: noticeError } = await client
      .from('notifications')
      .select('recipient,activity_id,read_at')
      .eq('id', event.notification_id)
      .single();
    if (noticeError) failure = 'Notificação não encontrada';
    else {
      const { data: profile } = await client
        .from('profiles')
        .select('active')
        .eq('id', notice.recipient)
        .single();
      const { data: subscriptions, error: subError } = await client
        .from('push_subscriptions')
        .select('id,endpoint,keys')
        .eq('user_id', notice.recipient)
        .eq('active', true);
      if (subError) failure = 'Falha ao consultar dispositivos';
      if (profile?.active && !notice.read_at)
        for (const sub of subscriptions ?? []) {
          const { data: delivered } = await client
            .from('notification_deliveries')
            .select('state')
            .eq('notification_id', event.notification_id)
            .eq('subscription_id', sub.id)
            .maybeSingle();
          if (delivered?.state === 'delivered') continue;
          try {
            // Push não expõe propriedade, nome de hóspede nem detalhes na tela bloqueada.
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys },
              JSON.stringify({
                title: 'AJA Anfitrião',
                body: 'Você tem uma atualização na sua operação.',
                url: '/notificacoes',
                tag: event.notification_id,
              }),
              { TTL: 3600, timeout: 5000 },
            );
            const { error: deliveryError } = await client
              .from('notification_deliveries')
              .upsert(
                {
                  notification_id: event.notification_id,
                  subscription_id: sub.id,
                  state: 'delivered',
                  error: null,
                },
                { onConflict: 'notification_id,subscription_id' },
              );
            if (deliveryError) failure = 'Falha ao registrar entrega';
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410)
              await client
                .from('push_subscriptions')
                .update({ active: false })
                .eq('id', sub.id);
            else failure = `Provedor push: ${status ?? 'rede indisponível'}`;
            await client.from('notification_deliveries').upsert(
              {
                notification_id: event.notification_id,
                subscription_id: sub.id,
                state: 'failed',
                error: `HTTP ${status ?? 0}`,
              },
              { onConflict: 'notification_id,subscription_id' },
            );
          }
        }
    }
    const { error: finishError } = await client.rpc('finish_outbox', {
      event_id: event.id,
      failure,
    });
    if (finishError)
      return res
        .status(500)
        .json({ error: 'Falha ao confirmar processamento' });
    processed++;
  }
  return res.status(200).json({ processed });
}
