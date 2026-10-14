import type { VercelRequest, VercelResponse } from '@vercel/node';
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res
    .status(200)
    .json({
      service: 'aja-anfitriao',
      configured: Boolean(
        process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY,
      ),
      time: new Date().toISOString(),
    });
}
