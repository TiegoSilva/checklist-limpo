import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
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
    return res
      .status(503)
      .json({
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
  if (activity && !body.item)
    return res.status(400).json({ error: 'Item obrigatório' });
  const server = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: existing } = await server
    .from(activity ? 'evidence_files' : 'service_evidence')
    .select('id,sha256,uploader')
    .eq('id', body.file_id)
    .maybeSingle();
  if (existing?.uploader === user.id)
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
  if (file.size > 10485760)
    return res.status(422).json({ error: 'Limite de 10 MB excedido' });
  const buffer = Buffer.from(await file.arrayBuffer());
  const supported =
    buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP');
  if (!supported)
    return res
      .status(422)
      .json({ error: 'O arquivo não é uma imagem JPG, PNG ou WebP válida' });
  const hash = createHash('sha256').update(buffer).digest('hex');
  const { error: receiptError } = await server.rpc(
    activity ? 'receive_evidence' : 'receive_service_evidence',
    {
      actor: user.id,
      ...(activity
        ? { activity: body.resource, item: body.item }
        : { service: body.resource }),
      file_id: body.file_id,
      hash,
    },
  );
  if (receiptError)
    return res.status(422).json({ error: receiptError.message });
  return res
    .status(200)
    .json({ file_id: body.file_id, sha256: hash, confirmed: true });
}
