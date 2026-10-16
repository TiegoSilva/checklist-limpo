import type { VercelRequest, VercelResponse } from '@vercel/node';
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    service: 'aja-anfitriao',
    configured: Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY,
    ),
    pushConfigured: Boolean(
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
    ),
    time: new Date().toISOString(),
  });
}
