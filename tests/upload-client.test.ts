import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  create: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
  getSession: vi.fn(),
  instances: [] as { options: Record<string, any> }[],
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.create }));
vi.mock('tus-js-client', () => ({
  Upload: class {
    options: Record<string, any>;
    constructor(_file: File, options: Record<string, any>) {
      this.options = options;
      mock.instances.push(this);
    }
    findPreviousUploads() {
      return Promise.resolve([]);
    }
    resumeFromPreviousUpload() {}
    start() {
      mock.upload(this.options);
    }
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-key');
  mock.instances.length = 0;
  mock.create.mockReturnValue({
    rpc: vi.fn(async () => ({ error: null, data: null })),
    auth: { getSession: mock.getSession },
    storage: { from: () => ({ list: mock.list }) },
  });
  mock.getSession.mockResolvedValue({
    data: { session: { user: { id: 'me' }, access_token: 'private-token' } },
  });
  mock.list.mockResolvedValue({ data: [], error: null });
  mock.upload.mockImplementation((options) => {
    options.onProgress(4, 4);
    options.onSuccess({});
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const receipt = (id = 'file') =>
  new Response(JSON.stringify({ confirmed: true, file_id: id }), {
    status: 200,
  });
it('só confirma upload após recibo e mostra upload, confirmação e conclusão nessa ordem', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => receipt()),
  );
  const { uploadPhoto } = await import('../src/lib/client');
  const progress = vi.fn();
  await uploadPhoto(
    'activity',
    'activity',
    new File(['foto'], 'cozinha.jpg', { type: 'image/jpeg' }),
    '__activity__',
    'file',
    progress,
  );
  expect(progress.mock.calls.map(([p]) => p.phase)).toEqual([
    'upload',
    'upload',
    'receipt',
    'complete',
  ]);
  expect(mock.instances[0].options.chunkSize).toBe(6 * 1024 * 1024);
  expect(mock.instances[0].options.headers['x-upsert']).toBe('false');
  expect(mock.instances[0].options.endpoint).toBe(
    'https://project.storage.supabase.co/storage/v1/upload/resumable',
  );
});
it('não considera um arquivo confirmado quando a API devolve HTML ou recibo de outro arquivo', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>Portal</html>', { status: 200 })),
  );
  const { uploadPhoto } = await import('../src/lib/client');
  const file = new File(['foto'], 'sala.jpg', { type: 'image/jpeg' });
  await expect(
    uploadPhoto('activity', 'activity', file, '__activity__', 'file'),
  ).rejects.toThrow(
    /sala.jpg.*upload realizado, mas recebimento não confirmado/,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => receipt('outro')),
  );
  await expect(
    uploadPhoto('activity', 'activity', file, '__activity__', 'file'),
  ).rejects.toThrow(/não confirmou/);
});
it('retoma a confirmação de um objeto já enviado sem reenviar seus bytes', async () => {
  mock.list.mockResolvedValue({ data: [{ name: 'file' }], error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => receipt()),
  );
  const { uploadPhoto } = await import('../src/lib/client');
  await uploadPhoto(
    'activity',
    'activity',
    new File(['foto'], 'quarto.jpg', { type: 'image/jpeg' }),
    '__activity__',
    'file',
  );
  expect(mock.instances).toHaveLength(0);
});
it('identifica o arquivo que falhou e não emite conclusão de upload', async () => {
  mock.upload.mockImplementation((options) =>
    options.onError(new Error('Network failed')),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Objeto não encontrado' }), {
          status: 422,
        }),
    ),
  );
  const { uploadPhoto } = await import('../src/lib/client');
  const progress = vi.fn();
  await expect(
    uploadPhoto(
      'activity',
      'activity',
      new File(['foto'], 'banheiro.jpg', { type: 'image/jpeg' }),
      '__activity__',
      'file',
      progress,
    ),
  ).rejects.toThrow(/banheiro.jpg/);
  expect(progress.mock.calls.some(([p]) => p.phase === 'complete')).toBe(false);
});

it('permanece aguardando enquanto os bytes terminaram mas o recibo ainda não chegou', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  const { uploadPhoto } = await import('../src/lib/client');
  const progress = vi.fn();
  let completed = false;
  const sending = uploadPhoto(
    'activity',
    'activity',
    new File(['foto'], 'entrada.jpg', { type: 'image/jpeg' }),
    '__activity__',
    'file',
    progress,
  ).then(() => {
    completed = true;
  });
  await vi.waitFor(() =>
    expect(progress).toHaveBeenCalledWith({ percent: 100, phase: 'receipt' }),
  );
  expect(completed).toBe(false);
  release(receipt());
  await sending;
  expect(completed).toBe(true);
});
