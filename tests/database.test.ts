import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
const admin = '00000000-0000-4000-8000-000000000001',
  worker = '00000000-0000-4000-8000-000000000002',
  outsider = '00000000-0000-4000-8000-000000000003';
let db: PGlite,
  org: string,
  property: string,
  unit: string,
  inspection: string,
  cleaning: string;
let eventId = '00000000-0000-4000-8000-000000000010';
let sharedUnit: string, firstSharedVersion: string, sharedCycle: string;
const sharedCup = {
  id: 'cup',
  room: 'Cozinha',
  title: 'Copos',
  mode: 'count',
  required: true,
  evidence_required: false,
  expected: 4,
};
const sharedTowel = {
  id: 'towel-shared',
  room: 'Banheiro',
  title: 'Toalhas',
  mode: 'count',
  required: true,
  evidence_required: false,
  expected: 1,
  quantity_per_guest: 1,
};
const item = {
  id: 'bed',
  room: 'Quarto',
  title: 'Conferir cama',
  mode: 'task',
  required: true,
  evidence_required: true,
};
async function asUser(id: string) {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`,
  );
}
async function rpc(name: string, args: unknown[] = []) {
  // Os fluxos de teste editam a versão atual; testes de conflito enviam a base explicitamente.
  if (name === 'configure' && args[0] === 'template') {
    const payload = JSON.parse(args[1] as string);
    if (!Object.hasOwn(payload, 'base_template_id')) {
      const current = await db.query<{ id: string }>(
        'select id from checklist_template_versions where unit_id=$1 and kind=$2 order by version desc limit 1',
        [payload.unit_id, payload.kind],
      );
      args = [
        args[0],
        JSON.stringify({
          ...payload,
          base_template_id: current.rows[0]?.id ?? null,
        }),
      ];
    }
  }
  const marks = args.map((_, i) => `$${i + 1}`).join(',');
  const r = await db.query<Record<string, unknown>>(
    `select public.${name}(${marks}) as value`,
    args,
  );
  return r.rows[0]?.value;
}
async function receive(
  activity: string,
  item: string,
  file: string,
  hash: string,
) {
  await db.exec('reset role;set role service_role;');
  try {
    return await rpc('receive_evidence', [worker, activity, item, file, hash]);
  } finally {
    await asUser(worker);
  }
}
async function action(id: string, act: string, payload: unknown = {}) {
  const r = await db.query<{ revision: number }>(
    'select revision from activities where id=$1',
    [id],
  );
  return rpc('activity_action', [
    id,
    r.rows[0].revision,
    act,
    JSON.stringify(payload),
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 grant usage on schema public,auth,storage to authenticated; grant select,insert on storage.objects to authenticated;
 insert into auth.users values('${admin}','admin@aja.test'),('${worker}','worker@aja.test'),('${outsider}','outsider@aja.test');`);
  for (const file of (
    await readdir(new URL('../supabase/migrations/', import.meta.url))
  )
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = (
      await readFile(
        new URL('../supabase/migrations/' + file, import.meta.url),
        'utf8',
      )
    )
      .replace('create extension if not exists pgcrypto;', '')
      .replace(/alter publication supabase_realtime[^;]+;/g, '');
    await db.exec(sql);
  }
  await asUser(admin);
  org = (await rpc('bootstrap', ['AJA Teste', 'Gestor'])) as string;
  property = (await rpc('configure', [
    'property',
    JSON.stringify({ org_id: org, name: 'Empreendimento de teste' }),
  ])) as string;
  unit = (await rpc('configure', [
    'unit',
    JSON.stringify({
      property_id: property,
      name: 'Unidade teste',
      capacity: 4,
      base_occupancy: 2,
    }),
  ])) as string;
  await rpc('configure', [
    'member',
    JSON.stringify({
      org_id: org,
      email: 'worker@aja.test',
      name: 'Colaborador',
      roles: ['cleaner', 'inspector', 'manager'],
      properties: [property],
    }),
  ]);
  for (const kind of ['inspection', 'cleaning'])
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: unit,
        kind,
        items: [
          { ...item, evidence_required: kind === 'cleaning' },
          {
            id: 'extra',
            room: 'Quarto',
            title: 'Preparar sofá-cama',
            mode: 'task',
            required: true,
            min_guests: 3,
          },
        ],
      }),
    ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('operações reais em PostgreSQL com RLS', () => {
  it('bloqueia acesso não autenticado', async () => {
    await db.exec('reset role;set role anon;');
    await expect(db.query('select * from activities')).rejects.toThrow(
      /permission denied/,
    );
    await expect(rpc('bootstrap', ['Outra', 'Intruso'])).rejects.toThrow(
      /permission denied/,
    );
  });
  it('cria exatamente duas atividades no checkout e mantém idempotência', async () => {
    await asUser(admin);
    const payload = {
      event_id: eventId,
      unit_id: unit,
      guest_name: 'Hóspede teste',
      guests: 2,
      checkin: '2026-10-12',
      checkout: '2026-10-14',
      inspector: worker,
      cleaner: worker,
      due_at: '2026-10-14T18:00:00Z',
    };
    const first = await rpc('confirm_checkout', [JSON.stringify(payload)]);
    expect(await rpc('confirm_checkout', [JSON.stringify(payload)])).toBe(
      first,
    );
    const result = await db.query<{
      id: string;
      kind: string;
      items: ItemLike[];
    }>('select id,kind,items from activities');
    expect(result.rows).toHaveLength(2);
    inspection = result.rows.find((a) => a.kind === 'inspection')!.id;
    cleaning = result.rows.find((a) => a.kind === 'cleaning')!.id;
    expect(result.rows[0].items).toHaveLength(1);
  });
  it('isola propriedades e impede mutação direta de estado', async () => {
    await asUser(outsider);
    expect((await db.query('select * from activities')).rows).toHaveLength(0);
    await expect(
      rpc('activity_action', [cleaning, 0, 'start', '{}']),
    ).rejects.toThrow(/Acesso negado/);
    await asUser(worker);
    await expect(
      db.query("update activities set status='completed' where id=$1", [
        cleaning,
      ]),
    ).rejects.toThrow(/permission denied/);
  });
  it('impede conclusão sem confirmação explícita', async () => {
    await asUser(worker);
    await action(inspection, 'start');
    await expect(action(inspection, 'submit')).rejects.toThrow(
      /explicitamente/,
    );
    await action(inspection, 'save', {
      responses: { bed: { confirmed: true } },
    });
    await action(inspection, 'submit');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from activities where id=$1',
          [inspection],
        )
      ).rows[0].status,
    ).toBe('completed');
  });
  it('exige fotografia antes da submissão e bloqueia concorrência', async () => {
    await action(cleaning, 'start');
    await action(cleaning, 'save', { responses: { bed: { confirmed: true } } });
    await expect(action(cleaning, 'submit')).rejects.toThrow(/fotografias/);
    await expect(
      rpc('activity_action', [cleaning, 0, 'save', '{"responses":{}}']),
    ).rejects.toThrow(/CONFLICT/);
  });
  it('valida upload e mantém evidências imutáveis', async () => {
    const id = '00000000-0000-4000-8000-000000000020';
    await expect(receive(cleaning, 'bed', id, 'a'.repeat(64))).rejects.toThrow(
      /Envie primeiro/,
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('evidence',$1)",
      [`${cleaning}/${id}`],
    );
    await receive(cleaning, 'bed', id, 'a'.repeat(64));
    expect((await db.query('select * from evidence_files')).rows).toHaveLength(
      1,
    );
    await expect(db.query('delete from evidence_files')).rejects.toThrow(
      /permission denied/,
    );
    await action(cleaning, 'submit');
  });
  it('proíbe autoaprovação mesmo com perfil de gestor', async () => {
    await expect(action(cleaning, 'approve')).rejects.toThrow(/Autoaprovação/);
  });
  it('exige justificativa e itens na correção, preservando o snapshot', async () => {
    await asUser(admin);
    await expect(
      action(cleaning, 'reject', { reason: 'x', items: ['bed'] }),
    ).rejects.toThrow(/Justificativa/);
    await expect(
      action(cleaning, 'reject', { reason: 'Refazer a cama', items: [] }),
    ).rejects.toThrow(/Selecione/);
    await action(cleaning, 'reject', {
      reason: 'Refazer a cama',
      items: ['bed'],
    });
    const r = await db.query<{
      snapshot: { responses: unknown };
      decision: string;
    }>(
      'select snapshot,decision from checklist_review_cycles where activity_id=$1',
      [cleaning],
    );
    expect(r.rows[0].decision).toBe('rejected');
    expect(r.rows[0].snapshot.responses).toEqual({ bed: { confirmed: true } });
  });
  it('notifica atribuição, revisão e correção de forma persistente', async () => {
    await db.exec('reset role;');
    const notices = await db.query('select * from notifications');
    expect(notices.rows.length).toBeGreaterThanOrEqual(5);
    const outbox = await db.query('select * from event_outbox');
    expect(outbox.rows).toHaveLength(notices.rows.length);
    await asUser(worker);
  });
  it('exige nova foto na correção e bloqueia liberação com ocorrência impeditiva', async () => {
    await action(cleaning, 'save', { responses: { bed: { confirmed: true } } });
    await expect(action(cleaning, 'submit')).rejects.toThrow(/fotografias/);
    const file = '00000000-0000-4000-8000-000000000021';
    await db.query(
      "insert into storage.objects(bucket_id,name) values('evidence',$1)",
      [`${cleaning}/${file}`],
    );
    await receive(cleaning, 'bed', file, 'b'.repeat(64));
    const finding = await rpc('create_finding', [
      cleaning,
      JSON.stringify({
        title: 'Vazamento',
        description: 'Água na cozinha',
        blocking: true,
      }),
    ]);
    await action(cleaning, 'submit');
    await asUser(admin);
    await expect(action(cleaning, 'approve')).rejects.toThrow(/impeditivas/);
    await rpc('resolve_finding', [finding, 'Reparo conferido pelo gestor']);
    await action(cleaning, 'approve');
    const u = await db.query<{ operational_status: string }>(
      'select operational_status from units where id=$1',
      [unit],
    );
    expect(u.rows[0].operational_status).toBe('ready');
  });
  it('registra ator, horário oficial e impede alterar auditoria', async () => {
    const rows = await db.query<{
      actor: string;
      created_at: string;
      event: string;
    }>('select actor,created_at,event from audit_events');
    expect(rows.rows.length).toBeGreaterThan(10);
    expect(rows.rows.every((r) => r.actor && r.created_at)).toBe(true);
    await expect(db.query('delete from audit_events')).rejects.toThrow(
      /permission denied/,
    );
  });
  it('exige gestor diferente para aprovar ordem de serviço', async () => {
    const id = (await rpc('service_action', [
      'create',
      JSON.stringify({
        unit_id: unit,
        title: 'Trocar lâmpada',
        description: 'Lâmpada do banheiro',
        assignee: worker,
        due_at: '2026-10-15T18:00:00Z',
        priority: 'normal',
        blocking: false,
      }),
    ])) as string;
    await asUser(worker);
    await rpc('service_action', ['start', JSON.stringify({ id, revision: 0 })]);
    await expect(
      rpc('service_action', [
        'submit',
        JSON.stringify({
          id,
          revision: 1,
          note: 'Lâmpada substituída e testada',
        }),
      ]),
    ).rejects.toThrow(/fotografia/);
    const file = '00000000-0000-4000-8000-000000000040';
    await db.query(
      "insert into storage.objects(bucket_id,name) values('service-evidence',$1)",
      [`${id}/${file}`],
    );
    await db.exec('reset role;set role service_role;');
    await rpc('receive_service_evidence', [worker, id, file, 'c'.repeat(64)]);
    await asUser(worker);
    await rpc('service_action', [
      'submit',
      JSON.stringify({
        id,
        revision: 1,
        note: 'Lâmpada substituída e testada',
      }),
    ]);
    await expect(
      rpc('service_action', ['approve', JSON.stringify({ id, revision: 2 })]),
    ).rejects.toThrow(/não permitida/);
    await asUser(admin);
    await rpc('service_action', [
      'approve',
      JSON.stringify({ id, revision: 2 }),
    ]);
  });
  it('gera apenas tarefas complementares quando a ocupação muda', async () => {
    const payload = {
      event_id: '00000000-0000-4000-8000-000000000030',
      unit_id: unit,
      guest_name: 'Próximo hóspede',
      guests: 4,
      checkin: '2026-10-16',
      checkout: '2026-10-18',
      assignee: worker,
      due_at: '2026-10-15T18:00:00Z',
    };
    const id = await rpc('confirm_reservation', [JSON.stringify(payload)]);
    const result = await db.query<{ kind: string; items: ItemLike[] }>(
      'select kind,items from activities where id=$1',
      [id],
    );
    expect(result.rows[0].kind).toBe('complement');
    expect(result.rows[0].items.map((i) => i.id)).toEqual(['extra']);
    expect(
      await rpc('confirm_reservation', [JSON.stringify(payload)]),
    ).toBeNull();
    expect(
      (
        await db.query<{ operational_status: string }>(
          'select operational_status from units where id=$1',
          [unit],
        )
      ).rows[0].operational_status,
    ).toBe('adjustment');
  });
  it('não permite que o cliente reivindique a fila push', async () => {
    await expect(rpc('claim_outbox', [20])).rejects.toThrow(
      /permission denied/,
    );
    await asUser(worker);
    await expect(
      rpc('subscribe_push', [
        JSON.stringify({
          endpoint: 'https://evil.example/private',
          keys: { auth: 'a'.repeat(22), p256dh: 'b'.repeat(88) },
        }),
      ]),
    ).rejects.toThrow(/Provedor push/);
  });
  it('protege fotos contra leitura de outra propriedade e proíbe envio a atividade finalizada', async () => {
    await asUser(outsider);
    expect(
      (
        await db.query(
          "select * from storage.objects where bucket_id='evidence'",
        )
      ).rows,
    ).toHaveLength(0);
    await asUser(worker);
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values('evidence',$1)",
        [`${cleaning}/nao-permitido`],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      rpc('register_evidence', [cleaning, 'bed', eventId, 'a'.repeat(64)]),
    ).rejects.toThrow(/permission denied/);
  });
  it('não altera o snapshot de uma execução ao publicar nova versão', async () => {
    await asUser(admin);
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: unit,
        kind: 'cleaning',
        items: [{ ...item, title: 'Novo padrão de cama' }],
      }),
    ]);
    const a = await db.query<{ items: ItemLike[] }>(
      'select items from activities where id=$1',
      [cleaning],
    );
    expect((a.rows[0].items[0] as { title?: string }).title).toBe(
      'Conferir cama',
    );
    await expect(
      db.query("update checklist_template_versions set items='[]'"),
    ).rejects.toThrow(/permission denied/);
  });
  it('aplica quantidade por hóspede e exige observação em contagens divergentes', async () => {
    const u = await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Contagem teste',
        capacity: 4,
        base_occupancy: 2,
      }),
    ]);
    for (const kind of ['inspection', 'cleaning'])
      await rpc('configure', [
        'template',
        JSON.stringify({
          unit_id: u,
          kind,
          items: [
            {
              id: 'towel',
              room: 'Banheiro',
              title: 'Toalhas',
              mode: 'count',
              required: true,
              expected: 2,
              quantity_per_guest: 1,
            },
          ],
        }),
      ]);
    await rpc('confirm_checkout', [
      JSON.stringify({
        event_id: '00000000-0000-4000-8000-000000000050',
        unit_id: u,
        guest_name: 'Teste de enxoval',
        guests: 2,
        checkin: '2026-10-12',
        checkout: '2026-10-14',
        inspector: worker,
        cleaner: worker,
        due_at: '2026-10-15T18:00:00Z',
      }),
    ]);
    const r = await db.query<{ id: string; items: { expected: number }[] }>(
      "select id,items from activities where unit_id=$1 and kind='inspection'",
      [u],
    );
    const a = r.rows[0];
    expect(a.items[0].expected).toBe(2);
    await asUser(worker);
    await action(a.id, 'start');
    await action(a.id, 'save', {
      responses: {
        towel: { confirmed: true, found: 1, condition: 'divergent' },
      },
    });
    await expect(action(a.id, 'submit')).rejects.toThrow(/divergência/);
    await action(a.id, 'save', {
      responses: {
        towel: {
          confirmed: true,
          found: 1,
          condition: 'divergent',
          note: 'Uma toalha não localizada; verificar lavanderia',
          laundry: 1,
          missing: 0,
        },
      },
    });
    await action(a.id, 'submit');
    const saved = await db.query<{
      responses: { towel: { laundry: number; missing: number } };
    }>('select responses from activities where id=$1', [a.id]);
    expect(saved.rows[0].responses.towel).toMatchObject({
      laundry: 1,
      missing: 0,
    });
  });
  it('reivindica lotes distintos na fila e agenda recuperação com backoff', async () => {
    await db.exec('reset role;set role service_role;');
    const a = await db.query<{ id: string }>('select id from claim_outbox(2)');
    const b = await db.query<{ id: string }>('select id from claim_outbox(2)');
    expect(a.rows).toHaveLength(2);
    expect(b.rows.some((x) => a.rows.some((y) => y.id === x.id))).toBe(false);
    await rpc('finish_outbox', [
      a.rows[0].id,
      'Rede temporariamente indisponível',
    ]);
    const result = await db.query<{
      state: string;
      attempts: number;
      future: boolean;
    }>(
      'select state,attempts,next_attempt_at>now() as future from event_outbox where id=$1',
      [a.rows[0].id],
    );
    expect(result.rows[0]).toMatchObject({
      state: 'pending',
      attempts: 1,
      future: true,
    });
    await asUser(admin);
  });
  it('valida assinatura push e permite desativar o dispositivo do próprio usuário', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/dispositivo-teste';
    await rpc('subscribe_push', [
      JSON.stringify({
        endpoint,
        keys: { auth: 'a'.repeat(22), p256dh: 'b'.repeat(88) },
      }),
    ]);
    expect(
      (
        await db.query('select * from push_subscriptions where endpoint=$1', [
          endpoint,
        ])
      ).rows,
    ).toHaveLength(1);
    await rpc('unsubscribe_push', [endpoint]);
    expect(
      (
        await db.query<{ active: boolean }>(
          'select active from push_subscriptions where endpoint=$1',
          [endpoint],
        )
      ).rows[0].active,
    ).toBe(false);
  });
  it('não deixa desativar a própria conta ou remover a última administração', async () => {
    await expect(
      rpc('set_member_active', [org, admin, false, 'Tentativa indevida']),
    ).rejects.toThrow(/própria conta/);
    await expect(
      rpc('configure', [
        'member',
        JSON.stringify({
          org_id: org,
          email: 'admin@aja.test',
          name: 'Gestor',
          roles: ['manager'],
          properties: [property],
        }),
      ]),
    ).rejects.toThrow(/ao menos um administrador/);
  });
  it('cria o checkout com os mesmos itens de quantidade e mantém limpeza exclusiva', async () => {
    await asUser(admin);
    sharedUnit = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Itens compartilhados',
        capacity: 6,
        base_occupancy: 2,
      }),
    ])) as string;
    firstSharedVersion = (await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: sharedUnit,
        kind: 'cleaning',
        items: [
          sharedCup,
          sharedTowel,
          {
            ...item,
            id: 'clean-bathroom',
            title: 'Limpar banheiro',
            evidence_required: false,
          },
        ],
      }),
    ])) as string;
    const templates = await db.query<{ kind: string; items: { id: string }[] }>(
      'select kind,items from checklist_template_versions where unit_id=$1',
      [sharedUnit],
    );
    expect(templates.rows).toHaveLength(2);
    expect(
      templates.rows
        .find((t) => t.kind === 'inspection')!
        .items.map((i) => i.id),
    ).toEqual(['cup', 'towel-shared']);
    expect(
      templates.rows.find((t) => t.kind === 'cleaning')!.items.map((i) => i.id),
    ).toContain('clean-bathroom');
  });
  it('usa a ocupação encerrada no checkout e a próxima no check-in', async () => {
    sharedCycle = (await rpc('confirm_checkout', [
      JSON.stringify({
        event_id: '00000000-0000-4000-8000-000000000060',
        unit_id: sharedUnit,
        guest_name: 'Teste de ocupações',
        guests: 4,
        checkin: '2026-10-12',
        checkout: '2026-10-14',
        inspector: worker,
        cleaner: worker,
        due_at: '2026-10-15T18:00:00Z',
      }),
    ])) as string;
    const activities = await db.query<{
      kind: string;
      occupancy: number;
      items: { id: string; expected: number }[];
    }>('select kind,occupancy,items from activities where cycle_id=$1', [
      sharedCycle,
    ]);
    const inspection = activities.rows.find((a) => a.kind === 'inspection')!,
      cleaning = activities.rows.find((a) => a.kind === 'cleaning')!;
    expect(inspection.occupancy).toBe(4);
    expect(cleaning.occupancy).toBe(2);
    expect(
      inspection.items.find((i) => i.id === 'towel-shared')!.expected,
    ).toBe(4);
    expect(cleaning.items.find((i) => i.id === 'towel-shared')!.expected).toBe(
      2,
    );
  });
  it('edita nome e quantidade nos dois padrões sem alterar atividades existentes', async () => {
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: sharedUnit,
        kind: 'cleaning',
        items: [
          { ...sharedCup, title: 'Copos de vidro', expected: 6 },
          sharedTowel,
          {
            ...item,
            id: 'clean-bathroom',
            title: 'Limpar banheiro',
            evidence_required: false,
          },
        ],
      }),
    ]);
    const current = await db.query<{
      kind: string;
      items: { id: string; title: string; expected: number }[];
    }>(
      'select distinct on(kind) kind,items from checklist_template_versions where unit_id=$1 order by kind,version desc',
      [sharedUnit],
    );
    for (const template of current.rows)
      expect(template.items.find((i) => i.id === 'cup')).toMatchObject({
        title: 'Copos de vidro',
        expected: 6,
      });
    const snapshots = await db.query<{
      items: { id: string; title: string; expected: number }[];
    }>('select items from activities where cycle_id=$1', [sharedCycle]);
    for (const activity of snapshots.rows)
      expect(activity.items.find((i) => i.id === 'cup')).toMatchObject({
        title: 'Copos',
        expected: 4,
      });
  });
  it('reflete alterações e exclusões feitas no checkout sem copiar conferências exclusivas', async () => {
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: sharedUnit,
        kind: 'inspection',
        items: [
          { ...sharedCup, title: 'Copos de vidro', expected: 3 },
          {
            id: 'checkout-only',
            room: 'Geral',
            title: 'Verificar danos',
            mode: 'technical',
            required: true,
            evidence_required: false,
          },
        ],
      }),
    ]);
    const templates = await db.query<{
      kind: string;
      items: { id: string; expected: number }[];
    }>(
      'select distinct on(kind) kind,items from checklist_template_versions where unit_id=$1 order by kind,version desc',
      [sharedUnit],
    );
    for (const template of templates.rows) {
      expect(template.items.some((i) => i.id === 'towel-shared')).toBe(false);
      expect(template.items.find((i) => i.id === 'cup')!.expected).toBe(3);
    }
    expect(
      templates.rows.find((t) => t.kind === 'cleaning')!.items.map((i) => i.id),
    ).toContain('clean-bathroom');
    expect(
      templates.rows.find((t) => t.kind === 'cleaning')!.items.map((i) => i.id),
    ).not.toContain('checkout-only');
  });
  it('rejeita edição de versão antiga e protege o publicador privado', async () => {
    await expect(
      rpc('configure', [
        'template',
        JSON.stringify({
          unit_id: sharedUnit,
          kind: 'cleaning',
          base_template_id: firstSharedVersion,
          items: [sharedCup],
        }),
      ]),
    ).rejects.toThrow(/CONFLICT/);
    await expect(
      rpc('configure_legacy', [
        'template',
        JSON.stringify({
          unit_id: sharedUnit,
          kind: 'cleaning',
          items: [sharedCup],
        }),
      ]),
    ).rejects.toThrow(/permission denied/);
    await asUser(outsider);
    await expect(
      rpc('configure', [
        'template',
        JSON.stringify({
          unit_id: sharedUnit,
          kind: 'cleaning',
          items: [sharedCup],
        }),
      ]),
    ).rejects.toThrow(/Acesso negado/);
    await asUser(admin);
  });
  it('recusa quantidades inválidas e itens duplicados sem alterar versões', async () => {
    const before = await db.query(
      'select id from checklist_template_versions where unit_id=$1',
      [sharedUnit],
    );
    for (const expected of [-1, 1.5, 10000])
      await expect(
        rpc('configure', [
          'template',
          JSON.stringify({
            unit_id: sharedUnit,
            kind: 'cleaning',
            items: [{ ...sharedCup, expected }],
          }),
        ]),
      ).rejects.toThrow(/quantidade/);
    await expect(
      rpc('configure', [
        'template',
        JSON.stringify({
          unit_id: sharedUnit,
          kind: 'cleaning',
          items: [
            sharedCup,
            { ...sharedCup, id: 'duplicate', title: ' copos ' },
          ],
        }),
      ]),
    ).rejects.toThrow(/mesmo nome/);
    expect(
      (
        await db.query(
          'select id from checklist_template_versions where unit_id=$1',
          [sharedUnit],
        )
      ).rows,
    ).toHaveLength(before.rows.length);
  });
  it('publica pelo endpoint de edição usado pelo configurador', async () => {
    const current = await db.query<{ id: string; items: unknown }>(
      "select id,items from checklist_template_versions where unit_id=$1 and kind='cleaning' order by version desc limit 1",
      [sharedUnit],
    );
    const published = await rpc('save_checklist', [
      JSON.stringify({
        unit_id: sharedUnit,
        kind: 'cleaning',
        base_template_id: current.rows[0].id,
        items: current.rows[0].items,
      }),
    ]);
    expect(published).not.toBe(current.rows[0].id);
    const version = await db.query(
      'select id from checklist_template_versions where id=$1',
      [published],
    );
    expect(version.rows).toHaveLength(1);
  });
  it('reverte toda a edição se o checklist vinculado ficaria vazio', async () => {
    const u = await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Teste de transação',
        capacity: 4,
        base_occupancy: 2,
      }),
    ]);
    const base = await rpc('save_checklist', [
      JSON.stringify({
        unit_id: u,
        kind: 'cleaning',
        base_template_id: null,
        items: [sharedCup],
      }),
    ]);
    await expect(
      rpc('save_checklist', [
        JSON.stringify({
          unit_id: u,
          kind: 'cleaning',
          base_template_id: base,
          items: [{ ...item, evidence_required: false }],
        }),
      ]),
    ).rejects.toThrow(/ficaria vazio/);
    const versions = await db.query<{
      version: number;
      items: { id: string }[];
    }>(
      'select version,items from checklist_template_versions where unit_id=$1',
      [u],
    );
    expect(versions.rows).toHaveLength(2);
    expect(
      versions.rows.every((t) => t.version === 1 && t.items[0].id === 'cup'),
    ).toBe(true);
  });
  it('reconcilia checklists antigos em novas versões com autoria do sistema', async () => {
    const legacyUnit = await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Unidade legada',
        capacity: 4,
        base_occupancy: 2,
      }),
    ]);
    await db.exec('reset role;');
    await rpc('configure_legacy', [
      'template',
      JSON.stringify({
        unit_id: legacyUnit,
        kind: 'cleaning',
        items: [
          { ...sharedCup, expected: 5 },
          { ...item, id: 'legacy-cleaning', evidence_required: false },
        ],
      }),
    ]);
    await rpc('configure_legacy', [
      'template',
      JSON.stringify({
        unit_id: legacyUnit,
        kind: 'inspection',
        items: [
          { ...sharedCup, id: 'old-cup', expected: 2 },
          {
            id: 'plate',
            room: 'Cozinha',
            title: 'Pratos',
            mode: 'count',
            required: true,
            expected: 4,
          },
        ],
      }),
    ]);
    const migration = await readFile(
      new URL(
        '../supabase/migrations/202610140005_shared_checklist_items.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const reconciliation = migration.match(/do \$\$[\s\S]*?end \$\$;/)?.[0];
    expect(reconciliation).toBeTruthy();
    await db.exec(reconciliation!);
    const versions = await db.query<{
      version: number;
      items: { id: string; expected: number }[];
      publication_source: string;
      published_by: string | null;
    }>(
      'select version,items,publication_source,published_by from checklist_template_versions where unit_id=$1 order by version',
      [legacyUnit],
    );
    expect(versions.rows).toHaveLength(4);
    for (const row of versions.rows.filter((t) => t.version === 2)) {
      expect(row.items.find((i) => i.id === 'cup')!.expected).toBe(5);
      expect(row.items.some((i) => i.id === 'plate')).toBe(true);
      expect(row.publication_source).toBe('migration');
      expect(row.published_by).toBeNull();
    }
    const events = await db.query<{
      actor: string | null;
      actor_roles: string[];
    }>(
      "select actor,actor_roles from audit_events where property_id=$1 and event='checklist.items_reconciled'",
      [property],
    );
    expect(
      events.rows.every(
        (e) => e.actor === null && e.actor_roles[0] === 'system',
      ),
    ).toBe(true);
    await asUser(admin);
  });
});
type ItemLike = { id: string };

describe.sequential('check-in e agenda compartilhada', () => {
  let agendaUnit: string;
  const booking = '00000000-0000-4000-8000-000000000081';
  const payload = () => ({
    event_id: booking,
    unit_id: agendaUnit,
    guest_name: 'Nome privado',
    guests: 3,
    checkin: '2099-01-01',
    checkout: '2099-01-05',
    inspector: worker,
    cleaner: worker,
  });
  it('registra check-in com duas tarefas futuras, sem duplicar ou alterar o estado da unidade', async () => {
    await asUser(admin);
    agendaUnit = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Unidade agenda',
        capacity: 6,
        base_occupancy: 2,
      }),
    ])) as string;
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: agendaUnit,
        kind: 'cleaning',
        items: [sharedTowel],
      }),
    ]);
    expect(await rpc('register_checkin', [JSON.stringify(payload())])).toBe(
      booking,
    );
    expect(await rpc('register_checkin', [JSON.stringify(payload())])).toBe(
      booking,
    );
    const rows = await db.query<{
      id: string;
      kind: string;
      occupancy: number;
      items: any[];
      due_at: Date;
    }>('select * from activities where unit_id=$1 order by kind', [agendaUnit]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((a) => a.occupancy)).toEqual([2, 3]);
    expect(rows.rows[1].items[0].expected).toBe(3);
    expect(new Date(rows.rows[0].due_at).toISOString()).toBe(
      '2099-01-05T15:00:00.000Z',
    );
    expect(
      (
        await db.query<{ operational_status: string }>(
          'select operational_status from units where id=$1',
          [agendaUnit],
        )
      ).rows[0].operational_status,
    ).toBe('unavailable');
  });
  it('compartilha a agenda com colaboradores sem expor nome de hóspedes ou outras propriedades', async () => {
    await asUser(admin);
    await rpc('configure', [
      'member',
      JSON.stringify({
        org_id: org,
        email: 'outsider@aja.test',
        name: 'Equipe agenda',
        roles: ['cleaner'],
        properties: [property],
      }),
    ]);
    await asUser(outsider);
    const agenda = await db.query<Record<string, unknown>>(
      'select * from team_agenda where id=$1',
      [booking],
    );
    expect(agenda.rows).toHaveLength(1);
    expect(agenda.rows[0]).not.toHaveProperty('guest_name');
    expect(
      (
        await db.query('select * from activities where unit_id=$1', [
          agendaUnit,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query('select * from notifications where title=$1', [
          'Check-in e checkout programados',
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      rpc('reschedule_checkout', [
        booking,
        0,
        JSON.stringify({
          checkout: '2099-01-07',
          reason: 'Estadia prorrogada',
        }),
      ]),
    ).rejects.toThrow(/Acesso negado/);
    await asUser(admin);
    await rpc('configure', [
      'member',
      JSON.stringify({
        org_id: org,
        email: 'outsider@aja.test',
        name: 'Sem acesso',
        roles: ['cleaner'],
        properties: [],
      }),
    ]);
    await asUser(outsider);
    expect(
      (await db.query('select * from team_agenda where id=$1', [booking])).rows,
    ).toHaveLength(0);
  });
  it('prorroga e antecipa a saída movendo as mesmas tarefas e notificando a equipe', async () => {
    await asUser(admin);
    const before = (
      await db.query<{ id: string }>(
        'select id from activities where unit_id=$1 order by id',
        [agendaUnit],
      )
    ).rows;
    await rpc('reschedule_checkout', [
      booking,
      0,
      JSON.stringify({
        checkout: '2099-01-07',
        checkout_time: '11:00',
        reason: 'Hóspede estendeu a estadia',
      }),
    ]);
    await rpc('reschedule_checkout', [
      booking,
      1,
      JSON.stringify({
        checkout: '2099-01-04',
        checkout_time: '10:00',
        reason: 'Hóspede antecipou a saída',
      }),
    ]);
    const after = (
      await db.query<{ id: string; due_at: Date; revision: number }>(
        'select id,due_at,revision from activities where unit_id=$1 order by id',
        [agendaUnit],
      )
    ).rows;
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id));
    expect(
      after.every(
        (a) =>
          new Date(a.due_at).toISOString() === '2099-01-04T13:00:00.000Z' &&
          a.revision === 2,
      ),
    ).toBe(true);
    expect(
      (
        await db.query<{ checkout: Date }>(
          'select checkout from stays where id=$1',
          [booking],
        )
      ).rows[0].checkout,
    ).toBeTruthy();
    expect(
      (
        await db.query(
          'select * from audit_events where resource_id=$1 and event=$2',
          [booking, 'checkout.rescheduled'],
        )
      ).rows,
    ).toHaveLength(2);
    await asUser(worker);
    expect(
      (
        await db.query('select * from notifications where title=$1', [
          'Data do checkout alterada',
        ])
      ).rows,
    ).toHaveLength(2);
  });
  it('bloqueia conflitos de versão, datas inválidas, sobreposição e execução futura', async () => {
    await asUser(admin);
    await expect(
      rpc('reschedule_checkout', [
        booking,
        0,
        JSON.stringify({ checkout: '2099-01-08', reason: 'Versão antiga' }),
      ]),
    ).rejects.toThrow(/alterada/);
    await expect(
      rpc('reschedule_checkout', [
        booking,
        2,
        JSON.stringify({ checkout: '2098-12-31', reason: 'Data inválida' }),
      ]),
    ).rejects.toThrow(/saída válida/);
    await expect(
      rpc('reschedule_checkout', [
        booking,
        2,
        JSON.stringify({ checkout: '2099-01-08', reason: 'x' }),
      ]),
    ).rejects.toThrow(/justifique/);
    await expect(
      rpc('register_checkin', [
        JSON.stringify({
          ...payload(),
          event_id: '00000000-0000-4000-8000-000000000082',
          checkin: '2099-01-02',
        }),
      ]),
    ).rejects.toThrow(/outra hospedagem/);
    const a = (
      await db.query<{ id: string }>(
        'select id from activities where unit_id=$1 limit 1',
        [agendaUnit],
      )
    ).rows[0].id;
    await asUser(worker);
    await expect(action(a, 'start')).rejects.toThrow(/futura/);
    await expect(
      action(a, 'schedule', {
        reason: 'Alterar sozinha',
        assignee: worker,
        due_at: '2099-02-01',
        priority: 'normal',
      }),
    ).rejects.toThrow(/agenda da equipe/);
  });
  it('adapta a limpeza pendente à próxima entrada e impede estender sobre ela', async () => {
    await asUser(admin);
    await rpc('register_checkin', [
      JSON.stringify({
        ...payload(),
        event_id: '00000000-0000-4000-8000-000000000083',
        guests: 5,
        checkin: '2099-01-06',
        checkout: '2099-01-10',
      }),
    ]);
    const cleaning = (
      await db.query<{ occupancy: number; items: any[] }>(
        'select a.* from activities a join preparation_cycles c on c.id=a.cycle_id where c.reservation_id=$1 and a.kind=$2',
        [booking, 'cleaning'],
      )
    ).rows[0];
    expect(cleaning.occupancy).toBe(5);
    expect(cleaning.items[0].expected).toBe(5);
    await expect(
      rpc('reschedule_checkout', [
        booking,
        2,
        JSON.stringify({
          checkout: '2099-01-07',
          reason: 'Prorrogação conflitante',
        }),
      ]),
    ).rejects.toThrow(/conflita/);
  });
  it('preserva execuções iniciadas ao tentar mudar a saída', async () => {
    await asUser(admin);
    await db.exec('reset role;');
    await db.query(
      "update activities set status='in_progress',started_at=now() where cycle_id=(select id from preparation_cycles where reservation_id=$1) and kind='inspection'",
      [booking],
    );
    await asUser(admin);
    await expect(
      rpc('reschedule_checkout', [
        booking,
        2,
        JSON.stringify({
          checkout: '2099-01-05',
          reason: 'Execução já iniciada',
        }),
      ]),
    ).rejects.toThrow(/já foi iniciada/);
  });
});
