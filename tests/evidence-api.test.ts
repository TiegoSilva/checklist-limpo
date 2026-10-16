import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
const mocks = vi.hoisted(() => ({
  clients: [] as unknown[],
  send: vi.fn(),
  vapid: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mocks.clients.shift()),
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: mocks.vapid, sendNotification: mocks.send },
}));
import evidence from '../api/evidence';
import notifications from '../api/notifications';
const user = '00000000-0000-4000-8000-000000000001',
  resource = '00000000-0000-4000-8000-000000000002',
  fileId = '00000000-0000-4000-8000-000000000003';
function response() {
  const value = {
    statusCode: 0,
    body: {} as Record<string, unknown>,
    setHeader: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      this.body = body;
      return this;
    },
  };
  return value;
}
const request = (body: unknown = {}) =>
  ({
    method: 'POST',
    headers: { authorization: 'Bearer test-user' },
    body,
  }) as VercelRequest;
const auth = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: user } }, error: null })),
  },
};
beforeEach(() => {
  mocks.clients.length = 0;
  vi.clearAllMocks();
  for (const name of [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_SUBJECT',
  ])
    vi.stubEnv(
      name,
      name === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'test-config',
    );
  mocks.send.mockResolvedValue({ statusCode: 201 });
});
afterEach(() => vi.unstubAllEnvs());
describe('API de evidências e notificações', () => {
  it('confirma vídeo pelos bytes do Storage e só certifica metadados no servidor', async () => {
    const bytes = Buffer.alloc(24);
    bytes.writeUInt32BE(24, 0);
    bytes.write('ftyp', 4);
    bytes.write('isom', 8);
    const client = {
      ...auth,
      from: () => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({
          data: { id: resource, assignee: user, status: 'in_progress' },
          error: null,
        }),
      }),
    };
    const server = {
      from: () => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null }),
      }),
      storage: {
        from: () => ({
          download: async () => ({
            data: new Blob([bytes], { type: 'video/mp4' }),
            error: null,
          }),
        }),
      },
      rpc: vi.fn(async () => ({ error: null })),
    };
    mocks.clients.push(client, server);
    const res = response();
    await evidence(
      request({
        kind: 'activity',
        resource,
        file_id: fileId,
        item: '__activity__',
      }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(server.rpc).toHaveBeenCalledWith(
      'receive_media_evidence',
      expect.objectContaining({
        actor: user,
        resource,
        media_type: 'video/mp4',
        bytes: 24,
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
  it('não aceita arquivo renomeado para vídeo nem registra recibo de conteúdo inválido', async () => {
    const client = {
      ...auth,
      from: () => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({
          data: { id: resource, assignee: user, status: 'in_progress' },
          error: null,
        }),
      }),
    };
    const server = {
      from: () => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null }),
      }),
      storage: {
        from: () => ({
          download: async () => ({
            data: new Blob(['<html>arquivo falso</html>'], {
              type: 'video/mp4',
            }),
            error: null,
          }),
        }),
      },
      rpc: vi.fn(),
    };
    mocks.clients.push(client, server);
    const res = response();
    await evidence(
      request({ kind: 'activity', resource, file_id: fileId }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(422);
    expect(server.rpc).not.toHaveBeenCalled();
  });
  it('nega o disparo sem sessão ou segredo de cron', async () => {
    const res = response();
    await notifications(
      { method: 'POST', headers: {} } as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('envia o teste somente para uma assinatura ativa pertencente ao usuário autenticado', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/own-device';
    const filters: Record<string, unknown> = {};
    const server = {
      from: (table: string) => ({
        select() {
          return this;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return this;
        },
        single: async () => ({
          data: table === 'profiles' ? { active: true } : null,
        }),
        maybeSingle: async () => ({
          data:
            filters.user_id === user && filters.endpoint === endpoint
              ? { id: fileId, endpoint, keys: { auth: 'x', p256dh: 'y' } }
              : null,
        }),
      }),
    };
    mocks.clients.push(auth, server);
    const res = response();
    await notifications(
      request({ test_endpoint: endpoint }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(filters).toMatchObject({ user_id: user, endpoint, active: true });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint }),
      expect.stringContaining('"test":true'),
      expect.any(Object),
    );
  });
  it('não aceita um endpoint fornecido pelo cliente que não esteja vinculado à própria conta', async () => {
    const server = {
      from: (table: string) => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({
          data: table === 'profiles' ? { active: true } : null,
        }),
        maybeSingle: async () => ({ data: null }),
      }),
    };
    mocks.clients.push(auth, server);
    const res = response();
    await notifications(
      request({
        test_endpoint: 'https://fcm.googleapis.com/fcm/send/other-device',
      }),
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
