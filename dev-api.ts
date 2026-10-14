import type { Plugin } from 'vite';
import type { VercelRequest, VercelResponse } from '@vercel/node';
export function devApi(): Plugin {
  return {
    name: 'aja-local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (!path?.startsWith('/api/')) return next();
        const routes: Record<string, string> = {
          '/api/health': 'health',
          '/api/operation': 'operation',
          '/api/evidence': 'evidence',
          '/api/notifications': 'notifications',
        };
        const route = routes[path];
        if (!route) {
          res.statusCode = 404;
          res.end();
          return;
        }
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            const b = Buffer.from(chunk);
            size += b.length;
            if (size > 1024 * 1024) {
              res.statusCode = 413;
              res.end();
              return;
            }
            chunks.push(b);
          }
          const body = Buffer.concat(chunks).toString();
          const request = req as VercelRequest;
          request.body = body ? JSON.parse(body) : {};
          const response = res as VercelResponse;
          response.status = (status: number) => {
            res.statusCode = status;
            return response;
          };
          response.json = (value: unknown) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(value));
            return response;
          };
          const handler = await server.ssrLoadModule(`/api/${route}.ts`);
          await handler.default(request, response);
        } catch {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error:
                'Falha interna da API local. Verifique a configuração do ambiente.',
            }),
          );
        }
      });
    },
  };
}
