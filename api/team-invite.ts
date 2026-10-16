import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
const schema = z.object({
  request_id: z.uuid(),
  org_id: z.uuid(),
  email: z.email(),
  name: z.string().trim().min(2).max(160),
  roles: z.array(z.enum(['admin', 'manager', 'inspector', 'cleaner'])).min(1),
  properties: z.array(z.uuid()),
  send_link: z.boolean().optional(),
});
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } =
    process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY)
    return res.status(503).json({
      error: 'Configure o servidor para enviar convites.',
      code: 'INVITE_CONFIG',
    });
  const token = req.headers.authorization;
  if (!token?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Entre novamente para continuar.' });
  const body = schema.safeParse(req.body);
  if (!body.success)
    return res.status(400).json({
      error:
        'Confira nome, e-mail, organização, funções e propriedades do convite.',
    });
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: token } },
    auth: { persistSession: false },
  });
  const { data: auth, error: authError } = await client.auth.getUser(
    token.slice(7),
  );
  if (authError || !auth.user)
    return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  const { data: invitation, error } = await client.rpc('prepare_team_invite', {
    payload: body.data,
  });
  if (error)
    return res.status(422).json({
      error: error.message,
      code: error.code === 'PGRST202' ? 'INVITE_MIGRATION' : 'INVITE_SCOPE',
    });
  if (invitation.complete)
    return res.status(200).json({
      message: 'Acesso já configurado. O convite anterior foi preservado.',
    });
  const server = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let mailError: null | { message: string } = null;
  if (!invitation.existing) {
    const result = await server.auth.admin.inviteUserByEmail(body.data.email, {
      data: { name: body.data.name },
    });
    mailError = result.error;
  } else if (body.data.send_link || invitation.needs_link) {
    // Reenvio explícito: link de acesso para uma conta já existente, sem trocar sua senha.
    const mailer = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const result = await mailer.auth.signInWithOtp({
      email: body.data.email,
      options: { shouldCreateUser: false },
    });
    mailError = result.error;
  }
  if (mailError)
    return res.status(502).json({
      error: `Não foi possível enviar o convite. Confira o SMTP do Supabase e tente novamente após um minuto. ${mailError.message}`,
      code: 'INVITE_EMAIL',
    });
  const finished = await client.rpc('finish_team_invite', {
    invitation: invitation.id,
  });
  if (finished.error)
    return res.status(422).json({
      error: `O convite foi preparado, mas os acessos não foram confirmados. ${finished.error.message}`,
      code: 'INVITE_ACCESS',
    });
  return res.status(200).json({
    message: invitation.existing
      ? body.data.send_link
        ? 'Acessos atualizados e novo link enviado.'
        : 'Acessos da conta existente atualizados.'
      : 'Convite enviado e acessos configurados.',
  });
}
