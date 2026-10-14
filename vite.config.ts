import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { devApi } from './dev-api';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const name of [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_SUBJECT',
    'CRON_SECRET',
  ])
    if (env[name]) process.env[name] = env[name];
  return {
    plugins: [react(), tailwind(), devApi()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            supabase: ['@supabase/supabase-js'],
            forms: ['react-hook-form', 'zod', '@hookform/resolvers/zod'],
            query: ['@tanstack/react-query'],
            router: ['react-router-dom'],
          },
        },
      },
    },
  };
});
