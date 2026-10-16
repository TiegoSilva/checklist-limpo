import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { detectMedia, mediaError, VIDEO_LIMIT } from '../src/lib/media';
export const config = { maxDuration: 60 };
const schema = z.object({
  resource: z.uuid(),
  item: z.string().min(1).max(200).optional(),
  file_id: z.uuid(),
  kind: z.enum(['activity', 'service']),
});
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } =
    process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY)
    return res.status(503).json({
      error: 'Configure as variáveis do servidor para receber evidências.',
    });
  const token = req.headers.authorization;
  if (!token?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Autenticação necessária' });
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: token } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser(token.slice(7));
  if (authError || !user)
    return res.status(401).json({ error: 'Sessão inválida' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Dados inválidos' });
  const body = parsed.data;
  const activity = body.kind === 'activity';
  const { data: resource, error } = await client
    .from(activity ? 'activities' : 'service_orders')
    .select('id,assignee,status')
    .eq('id', body.resource)
    .single();
  if (
    error ||
    !resource ||
    resource.assignee !== user.id ||
    !(activity ? ['in_progress', 'correction'] : ['in_progress']).includes(
      resource.status,
    )
  )
    return res
      .status(403)
      .json({ error: 'Envio não autorizado para esta atividade' });
  const server = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: existing } = await server
    .from(activity ? 'evidence_files' : 'service_evidence')
    .select(
      activity
        ? 'id,sha256,uploader,activity_id'
        : 'id,sha256,uploader,service_id',
    )
    .eq('id', body.file_id)
    .maybeSingle();
  if (
    existing?.uploader === user.id &&
    ('activity_id' in existing ? existing.activity_id : existing.service_id) ===
      body.resource
  )
    return res
      .status(200)
      .json({ file_id: existing.id, sha256: existing.sha256, confirmed: true });
  const path = `${body.resource}/${body.file_id}`;
  const { data: file, error: downloadError } = await server.storage
    .from(activity ? 'evidence' : 'service-evidence')
    .download(path);
  if (downloadError || !file)
    return res
      .status(422)
      .json({ error: 'Arquivo não encontrado no armazenamento privado' });
  if (file.size > VIDEO_LIMIT)
    return res.status(422).json({ error: 'Limite de 50 MB excedido' });
  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = detectMedia(buffer);
  if (!mediaType)
    return res
      .status(422)
      .json({
        error:
          'Arquivo inválido. Use foto JPG, PNG ou WebP ou vídeo MP4, MOV ou WebM.',
      });
  const invalid = mediaError({ type: mediaType, size: file.size });
  if (invalid) return res.status(422).json({ error: invalid });
  const hash = createHash('sha256').update(buffer).digest('hex');
  const { error: receiptError } = await server.rpc('receive_media_evidence', {
    actor: user.id,
    resource: body.resource,
    kind: body.kind,
    item: body.item ?? '__activity__',
    file_id: body.file_id,
    hash,
    media_type: mediaType,
    bytes: file.size,
  });
  if (receiptError)
    return res
      .status(422)
      .json({
        error:
          receiptError.code === 'PGRST202'
            ? 'Aplique a migração 202610160013_video_and_device_push.sql no Supabase para receber fotos e vídeos.'
            : receiptError.message,
      });
  return res
    .status(200)
    .json({ file_id: body.file_id, sha256: hash, confirmed: true });
}
