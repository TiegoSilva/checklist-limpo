import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
const command = z.object({
  activity: z.uuid(),
  expected_revision: z.number().int().nonnegative(),
  action: z.enum([
    'start',
    'save',
    'submit',
    'approve',
    'reject',
    'schedule',
    'cancel',
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });
  const token = req.headers.authorization;
  if (!token?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Autenticação necessária' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
    return res.status(503).json({ error: 'Servidor não configurado' });
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: token } },
      auth: { persistSession: false },
    },
  );
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser(token.slice(7));
  if (authError || !user)
    return res.status(401).json({ error: 'Sessão inválida' });
  const body = command.safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({ error: 'Dados inválidos', details: body.error.flatten() });
  const { data, error } = await client.rpc('activity_action', body.data);
  if (error)
    return res
      .status(error.message.includes('CONFLICT') ? 409 : 422)
      .json({ error: error.message });
  return res.status(200).json({ revision: data });
}
