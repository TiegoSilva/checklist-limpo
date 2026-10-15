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
type ItemLike = { id: string; expected?: number };

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

describe.sequential('ordens de serviço, modelos e estadia', () => {
  let workUnit: string,
    modelIn: string,
    modelOut: string,
    inOrder: string,
    outOrder: string,
    inActivity: string,
    outActivity: string;
  const event = '00000000-0000-4000-8000-000000000091';
  const booking = () => ({
    event_id: event,
    unit_id: workUnit,
    order_type: 'checkin',
    execution_mode: 'checklist',
    template_id: modelIn,
    assignee: worker,
    checkout_assignee: worker,
    checkout_execution_mode: 'checklist',
    checkout_template_id: modelOut,
    guest_name: 'Hóspede privado',
    guests: 3,
    checkin: '2020-02-01',
    duration_nights: 3,
  });
  it('cria exatamente duas ordens e duas execuções com saída calculada pelas diárias', async () => {
    await asUser(admin);
    workUnit = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Unidade ordens',
        capacity: 6,
        base_occupancy: 2,
      }),
    ])) as string;
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: workUnit,
        kind: 'cleaning',
        items: [sharedTowel],
      }),
    ]);
    modelIn = (
      await db.query<{ id: string }>(
        "select id from checklist_template_versions where unit_id=$1 and kind='cleaning' order by version desc limit 1",
        [workUnit],
      )
    ).rows[0].id;
    modelOut = (
      await db.query<{ id: string }>(
        "select id from checklist_template_versions where unit_id=$1 and kind='inspection' order by version desc limit 1",
        [workUnit],
      )
    ).rows[0].id;
    inOrder = (await rpc('create_work_order', [
      JSON.stringify(booking()),
    ])) as string;
    expect(await rpc('create_work_order', [JSON.stringify(booking())])).toBe(
      inOrder,
    );
    const orders = (
      await db.query<{
        id: string;
        order_type: string;
        activity_id: string;
        parent_order_id: string;
        due_at: Date;
      }>(
        'select * from service_orders where reservation_id=$1 order by order_type',
        [event],
      )
    ).rows;
    expect(orders).toHaveLength(2);
    expect(orders[0].order_type).toBe('checkin');
    outOrder = orders[1].id;
    inActivity = orders[0].activity_id;
    outActivity = orders[1].activity_id;
    expect(orders[1].parent_order_id).toBe(inOrder);
    expect(new Date(orders[0].due_at).toISOString()).toBe(
      '2020-02-01T18:00:00.000Z',
    );
    expect(new Date(orders[1].due_at).toISOString()).toBe(
      '2020-02-04T15:30:00.000Z',
    );
    const activities = (
      await db.query<{ occupancy: number; items: ItemLike[] }>(
        'select * from activities where unit_id=$1',
        [workUnit],
      )
    ).rows;
    expect(activities).toHaveLength(2);
    expect(
      activities.every((a) => a.occupancy === 3 && a.items[0].expected === 3),
    ).toBe(true);
    const agenda = (
      await db.query<{
        duration_nights: number;
        checkin_order_id: string;
        checkout_order_id: string;
      }>('select * from team_agenda where id=$1', [event])
    ).rows[0];
    expect(agenda.duration_nights).toBe(3);
    expect(agenda.checkout_order_id).toBe(outOrder);
    expect(
      (
        await db.query<{ operational_status: string }>(
          'select operational_status from units where id=$1',
          [workUnit],
        )
      ).rows[0].operational_status,
    ).toBe('unavailable');
  });
  it('mantém a versão do modelo e as quantidades da OS após editar o modelo', async () => {
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: workUnit,
        kind: 'cleaning',
        items: [{ ...sharedTowel, quantity_per_guest: 2 }],
      }),
    ]);
    const before = (
      await db.query<{ template_id: string; items: ItemLike[] }>(
        'select * from activities where id=$1',
        [inActivity],
      )
    ).rows[0];
    expect(before.template_id).toBe(modelIn);
    expect(before.items[0].expected).toBe(3);
    expect(
      (
        await db.query<{ template_id: string }>(
          'select template_id from service_orders where id=$1',
          [inOrder],
        )
      ).rows[0].template_id,
    ).toBe(modelIn);
  });
  it('executa e aprova o check-in antes da saída, sem exigir concluir o checkout futuro', async () => {
    await asUser(worker);
    await expect(
      rpc('service_action', [
        'start',
        JSON.stringify({ id: inOrder, revision: 0 }),
      ]),
    ).rejects.toThrow(/pelo checklist/);
    await action(inActivity, 'start');
    await action(inActivity, 'save', {
      responses: {
        'towel-shared': { confirmed: true, found: 3, condition: 'ok' },
      },
    });
    await action(inActivity, 'submit');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [inOrder],
        )
      ).rows[0].status,
    ).toBe('review');
    await expect(action(inActivity, 'approve')).rejects.toThrow(
      /Autoaprovação/,
    );
    await asUser(admin);
    await action(inActivity, 'approve');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [inOrder],
        )
      ).rows[0].status,
    ).toBe('approved');
    expect(
      (
        await db.query<{ operational_status: string; prepared_for: number }>(
          'select * from units where id=$1',
          [workUnit],
        )
      ).rows[0],
    ).toMatchObject({ operational_status: 'ready', prepared_for: 3 });
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [outOrder],
        )
      ).rows[0].status,
    ).toBe('assigned');
  });
  it('prorroga a saída depois do check-in concluído sem mover ou duplicar a ordem de entrada', async () => {
    const before = (
      await db.query<{ due_at: Date }>(
        'select due_at from service_orders where id=$1',
        [inOrder],
      )
    ).rows[0];
    await rpc('reschedule_checkout', [
      event,
      0,
      JSON.stringify({
        checkout: '2020-02-05',
        reason: 'Estadia estendida pelo hóspede',
      }),
    ]);
    const after = (
      await db.query<{ due_at: Date }>(
        'select due_at from service_orders where id=$1',
        [inOrder],
      )
    ).rows[0];
    expect(new Date(after.due_at).toISOString()).toBe(
      new Date(before.due_at).toISOString(),
    );
    expect(
      (
        await db.query<{ duration_nights: number }>(
          'select duration_nights from team_agenda where id=$1',
          [event],
        )
      ).rows[0].duration_nights,
    ).toBe(4);
    expect(
      new Date(
        (
          await db.query<{ due_at: Date }>(
            'select due_at from activities where id=$1',
            [outActivity],
          )
        ).rows[0].due_at,
      ).toISOString(),
    ).toBe('2020-02-05T15:30:00.000Z');
    expect(
      (
        await db.query(
          'select id from service_orders where reservation_id=$1',
          [event],
        )
      ).rows,
    ).toHaveLength(2);
  });
  it('envia o checkout para revisão e bloqueia alterar sua data depois de iniciado', async () => {
    await asUser(worker);
    await action(outActivity, 'start');
    await asUser(admin);
    await expect(
      rpc('reschedule_checkout', [
        event,
        1,
        JSON.stringify({ checkout: '2020-02-06', reason: 'Saída já iniciada' }),
      ]),
    ).rejects.toThrow(/já foi iniciado/);
    await asUser(worker);
    await action(outActivity, 'save', {
      responses: {
        'towel-shared': { confirmed: true, found: 3, condition: 'ok' },
      },
    });
    await action(outActivity, 'submit');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [outOrder],
        )
      ).rows[0].status,
    ).toBe('review');
    await asUser(admin);
    await action(outActivity, 'approve');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [outOrder],
        )
      ).rows[0].status,
    ).toBe('approved');
  });
  it('cria check-in e checkout como tarefas simples mesmo sem modelos cadastrados', async () => {
    const taskUnit = await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Hospedagem por tarefa',
        capacity: 4,
        base_occupancy: 2,
      }),
    ]);
    const id = await rpc('create_work_order', [
      JSON.stringify({
        ...booking(),
        event_id: '00000000-0000-4000-8000-000000000092',
        unit_id: taskUnit,
        execution_mode: 'task',
        checkout_execution_mode: 'task',
        checkin: '2099-03-30',
        duration_nights: 2,
      }),
    ]);
    const orders = (
      await db.query<{ execution_mode: string; activity_id: string }>(
        'select * from service_orders where reservation_id=$1',
        [id],
      )
    ).rows;
    expect(orders).toHaveLength(2);
    expect(
      orders.every((s) => s.execution_mode === 'task' && !s.activity_id),
    ).toBe(true);
    expect(
      (await db.query('select * from activities where unit_id=$1', [taskUnit]))
        .rows,
    ).toHaveLength(0);
    await asUser(worker);
    await expect(
      rpc('service_action', ['start', JSON.stringify({ id, revision: 0 })]),
    ).rejects.toThrow(/data futura/);
    await asUser(admin);
  });
  it('executa um modelo em uma OS geral com revisão sem exigir ciclo de hospedagem', async () => {
    const id = await rpc('create_work_order', [
      JSON.stringify({
        event_id: '00000000-0000-4000-8000-000000000093',
        unit_id: workUnit,
        title: 'Conferência extraordinária',
        order_type: 'general',
        execution_mode: 'checklist',
        template_id: modelOut,
        assignee: worker,
        due_at: '2020-02-10T15:00:00Z',
        occupancy: 2,
      }),
    ]);
    const a = (
      await db.query<{ activity_id: string }>(
        'select activity_id from service_orders where id=$1',
        [id],
      )
    ).rows[0].activity_id;
    await asUser(worker);
    await action(a, 'start');
    await action(a, 'save', {
      responses: {
        'towel-shared': { confirmed: true, found: 2, condition: 'ok' },
      },
    });
    await action(a, 'submit');
    await asUser(admin);
    await action(a, 'approve');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [id],
        )
      ).rows[0].status,
    ).toBe('approved');
  });
  it('conclui o check-in como tarefa e permite editar apenas a saída vinculada', async () => {
    await asUser(admin);
    const taskUnit = await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Tarefa concluída de check-in',
        capacity: 4,
        base_occupancy: 2,
      }),
    ]);
    const id = (await rpc('create_work_order', [
      JSON.stringify({
        ...booking(),
        event_id: '00000000-0000-4000-8000-000000000095',
        unit_id: taskUnit,
        execution_mode: 'task',
        checkout_execution_mode: 'task',
        checkin: '2020-06-01',
        duration_nights: 2,
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
          note: 'Entrada conferida e hóspede recebido',
        }),
      ]),
    ).rejects.toThrow(/fotografia/);
    const file = '00000000-0000-4000-8000-000000000096';
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
        note: 'Entrada conferida e hóspede recebido',
      }),
    ]);
    await asUser(admin);
    await rpc('service_action', [
      'approve',
      JSON.stringify({ id, revision: 2 }),
    ]);
    await rpc('reschedule_checkout', [
      id,
      0,
      JSON.stringify({
        checkout: '2020-06-05',
        reason: 'Hóspede estendeu sua estadia',
      }),
    ]);
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [id],
        )
      ).rows[0].status,
    ).toBe('approved');
    const out = (
      await db.query<{ due_at: Date }>(
        'select due_at from service_orders where parent_order_id=$1',
        [id],
      )
    ).rows[0];
    expect(new Date(out.due_at).toISOString()).toBe('2020-06-05T15:30:00.000Z');
  });
  it('reverte a criação inteira quando a duração ou o modelo de check-in é inválido', async () => {
    const next = {
      ...booking(),
      event_id: '00000000-0000-4000-8000-000000000094',
      checkin: '2020-04-01',
    };
    await expect(
      rpc('create_work_order', [
        JSON.stringify({ ...next, duration_nights: 0 }),
      ]),
    ).rejects.toThrow(/diárias/);
    await expect(
      rpc('create_work_order', [
        JSON.stringify({ ...next, template_id: modelOut }),
      ]),
    ).rejects.toThrow(/Modelo incompatível/);
    expect(
      (
        await db.query('select id from service_orders where id=$1', [
          next.event_id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query('select id from reservations where id=$1', [
          next.event_id,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      rpc('attach_order_checklist', [
        workUnit,
        null,
        'general',
        worker,
        '2020-02-01',
        2,
        modelIn,
        'Invasão',
      ]),
    ).rejects.toThrow(/permission denied/);
    await asUser(outsider);
    await expect(
      rpc('create_work_order', [JSON.stringify(next)]),
    ).rejects.toThrow(/Acesso negado/);
    await asUser(admin);
  });
});

describe.sequential('remoção e restauração de modelos', () => {
  let archiveUnit: string, first: string, latest: string, activity: string;
  it('remove todas as versões do modelo, preservando ordens, snapshots e o par ativo', async () => {
    await asUser(admin);
    archiveUnit = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Modelos removíveis',
        capacity: 4,
        base_occupancy: 2,
      }),
    ])) as string;
    first = (await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: archiveUnit,
        kind: 'cleaning',
        items: [sharedTowel],
      }),
    ])) as string;
    const id = await rpc('create_work_order', [
      JSON.stringify({
        event_id: '00000000-0000-4000-8000-000000000101',
        unit_id: archiveUnit,
        order_type: 'general',
        execution_mode: 'checklist',
        template_id: first,
        title: 'Ordem preservada',
        assignee: worker,
        due_at: '2020-01-01T12:00:00Z',
      }),
    ]);
    activity = (
      await db.query<{ activity_id: string }>(
        'select activity_id from service_orders where id=$1',
        [id],
      )
    ).rows[0].activity_id;
    latest = (await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: archiveUnit,
        kind: 'cleaning',
        items: [{ ...sharedTowel, title: 'Toalhas novas' }],
      }),
    ])) as string;
    await rpc('set_checklist_archived', [latest, true]);
    expect(
      (
        await db.query(
          'select id from checklist_template_versions where unit_id=$1 and kind=$2 and archived_at is null',
          [archiveUnit, 'cleaning'],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          'select id from checklist_template_versions where unit_id=$1 and kind=$2 and archived_at is null',
          [archiveUnit, 'inspection'],
        )
      ).rows.length,
    ).toBeGreaterThan(0);
    const a = (
      await db.query<{ template_id: string; items: { title: string }[] }>(
        'select * from activities where id=$1',
        [activity],
      )
    ).rows[0];
    expect(a.template_id).toBe(first);
    expect(a.items[0].title).toBe('Toalhas');
    await expect(
      rpc('create_work_order', [
        JSON.stringify({
          unit_id: archiveUnit,
          order_type: 'general',
          execution_mode: 'checklist',
          template_id: first,
          title: 'Não pode usar removido',
          assignee: worker,
          due_at: '2020-01-01T12:00:00Z',
        }),
      ]),
    ).rejects.toThrow(/modelo foi removido/);
  });
  it('permite concluir uma execução existente mesmo com o modelo removido', async () => {
    await asUser(worker);
    await action(activity, 'start');
    await action(activity, 'save', {
      responses: {
        'towel-shared': { confirmed: true, found: 2, condition: 'ok' },
      },
    });
    await action(activity, 'submit');
    await asUser(admin);
    await action(activity, 'approve');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from activities where id=$1',
          [activity],
        )
      ).rows[0].status,
    ).toBe('completed');
  });
  it('exige gestão da propriedade e versão atual para remover ou restaurar', async () => {
    await asUser(outsider);
    await expect(
      rpc('set_checklist_archived', [latest, false]),
    ).rejects.toThrow(/Acesso negado/);
    await asUser(admin);
    await expect(rpc('set_checklist_archived', [first, false])).rejects.toThrow(
      /modelo mudou/,
    );
    await expect(
      db.query(
        'update checklist_template_versions set archived_at=null where id=$1',
        [latest],
      ),
    ).rejects.toThrow(/permission denied/);
    await rpc('set_checklist_archived', [latest, false]);
    expect(
      (
        await db.query(
          'select id from checklist_template_versions where unit_id=$1 and kind=$2 and archived_at is not null',
          [archiveUnit, 'cleaning'],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          'select id from audit_events where resource_id=$1 and event=$2',
          [latest, 'checklist.restored'],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it('não restaura o modelo removido ao sincronizar itens editados no par', async () => {
    await rpc('set_checklist_archived', [latest, true]);
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: archiveUnit,
        kind: 'inspection',
        items: [{ ...sharedTowel, expected: 3, title: 'Toalhas atualizadas' }],
      }),
    ]);
    expect(
      (
        await db.query(
          'select id from checklist_template_versions where unit_id=$1 and kind=$2 and archived_at is null',
          [archiveUnit, 'cleaning'],
        )
      ).rows,
    ).toHaveLength(0);
    latest = (
      await db.query<{ id: string }>(
        'select id from checklist_template_versions where unit_id=$1 and kind=$2 order by version desc limit 1',
        [archiveUnit, 'cleaning'],
      )
    ).rows[0].id;
    await expect(
      rpc('save_checklist', [
        JSON.stringify({
          unit_id: archiveUnit,
          kind: 'cleaning',
          base_template_id: latest,
          items: [sharedTowel],
        }),
      ]),
    ).rejects.toThrow(/Modelo removido/);
    const newId = await rpc('save_checklist', [
      JSON.stringify({
        unit_id: archiveUnit,
        kind: 'cleaning',
        base_template_id: null,
        items: [sharedTowel],
      }),
    ]);
    expect(
      (
        await db.query<{ archived_at: string | null }>(
          'select archived_at from checklist_template_versions where id=$1',
          [newId],
        )
      ).rows[0].archived_at,
    ).toBeNull();
    expect(
      (
        await db.query<{ archived_at: string | null }>(
          'select archived_at from checklist_template_versions where id=$1',
          [latest],
        )
      ).rows[0].archived_at,
    ).toBeTruthy();
  });
});

describe.sequential('checkout derivado, vínculos e janelas de execução', () => {
  let target: string,
    model: string,
    incoming: string,
    outgoing: string,
    activity: string,
    today: string;
  it('gera a saída da versão exata do check-in, com quantidades e horários padrão, ignorando escolhas independentes de saída', async () => {
    await asUser(admin);
    await rpc('configure', [
      'member',
      JSON.stringify({
        org_id: org,
        email: 'worker@aja.test',
        name: 'Colaborador',
        roles: ['cleaner', 'inspector'],
        properties: [property],
      }),
    ]);
    target = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Janelas',
        capacity: 6,
        base_occupancy: 2,
      }),
    ])) as string;
    model = (await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: target,
        kind: 'cleaning',
        items: [sharedCup, { ...item, evidence_required: false }],
      }),
    ])) as string;
    // Uma versão posterior não pode substituir a escolhida para a estadia.
    await rpc('configure', [
      'template',
      JSON.stringify({
        unit_id: target,
        kind: 'cleaning',
        items: [
          { ...sharedCup, expected: 9 },
          { ...item, evidence_required: false },
        ],
      }),
    ]);
    today = (
      await db.query<{ date_value: string }>(
        "select to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD') as date_value",
      )
    ).rows[0].date_value;
    const arrival = (
      await db.query<{ date_value: string }>(
        "select to_char((now() at time zone 'America/Sao_Paulo')::date-2,'YYYY-MM-DD') as date_value",
      )
    ).rows[0].date_value;
    incoming = (await rpc('create_scheduled_work_order', [
      JSON.stringify({
        unit_id: target,
        order_type: 'checkin',
        execution_mode: 'checklist',
        template_id: model,
        assignee: worker,
        checkout_assignee: worker,
        guest_name: 'Teste janela',
        guests: 2,
        duration_nights: 2,
        checkin: arrival,
        checkout_execution_mode: 'task',
        checkout_template_id: unit,
      }),
    ])) as string;
    const rows = (
      await db.query<{
        id: string;
        activity_id: string;
        template_id: string;
        checkin_order_id: string;
        start_time: string;
        end_time: string;
      }>(
        "select *,to_char(scheduled_start_at at time zone 'America/Sao_Paulo','HH24:MI') start_time,to_char(due_at at time zone 'America/Sao_Paulo','HH24:MI') end_time from service_orders where reservation_id=$1 order by order_type",
        [incoming],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.start_time, r.end_time])).toEqual([
      ['13:30', '15:00'],
      ['11:30', '12:30'],
    ]);
    expect(
      rows.every(
        (r) => r.checkin_order_id === incoming && r.template_id === model,
      ),
    ).toBe(true);
    outgoing = rows[1].id;
    activity = rows[1].activity_id;
    const out = (
      await db.query<{ items: ItemLike[]; kind: string; occupancy: number }>(
        'select * from activities where id=$1',
        [activity],
      )
    ).rows[0];
    expect(out.kind).toBe('inspection');
    expect(out.occupancy).toBe(2);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe('cup');
    expect(out.items[0].expected).toBe(4);
    const agenda = (
      await db.query<{ checkout_start_time: string; checkout_time: string }>(
        'select * from team_agenda where id=$1',
        [incoming],
      )
    ).rows[0];
    expect(agenda.checkout_start_time).toBe('11:30:00');
    expect(agenda.checkout_time).toBe('12:30:00');
    expect(
      await rpc('create_scheduled_work_order', [
        JSON.stringify({ event_id: incoming, unit_id: target }),
      ]),
    ).toBe(incoming);
  });
  it('vincula várias ordens extras ao mesmo check-in e rejeita origem de outra unidade', async () => {
    const payload = {
      unit_id: target,
      title: 'Trocar lâmpada',
      assignee: worker,
      due_at: today + 'T17:00:00-03:00',
      checkin_order_id: incoming,
    };
    for (let i = 0; i < 2; i++) {
      const id = await rpc('create_scheduled_work_order', [
        JSON.stringify(payload),
      ]);
      const row = (
        await db.query<{ checkin_order_id: string; reservation_id: string }>(
          'select * from service_orders where id=$1',
          [id],
        )
      ).rows[0];
      expect(row.checkin_order_id).toBe(incoming);
      expect(row.reservation_id).toBe(incoming);
    }
    await expect(
      rpc('create_scheduled_work_order', [
        JSON.stringify({ ...payload, unit_id: unit }),
      ]),
    ).rejects.toThrow(/origem incompatível/);
  });
  it('permite ao gestor ajustar a janela no dia, mesmo iniciada, preservando respostas e check-in', async () => {
    await asUser(worker);
    await action(activity, 'start');
    await action(activity, 'save', {
      responses: {
        cup: {
          confirmed: false,
          found: 3,
          condition: 'divergent',
          note: 'Falta um copo',
        },
      },
    });
    const before = (
      await db.query<{
        responses: unknown;
        items: unknown;
        started_at: unknown;
      }>('select * from activities where id=$1', [activity])
    ).rows[0];
    const inBefore = (
      await db.query('select * from service_orders where id=$1', [incoming])
    ).rows[0];
    const change = {
      checkout: today,
      checkout_start_time: '10:30',
      checkout_time: '11:45',
      reason: 'Hóspede saiu mais cedo',
    };
    await expect(
      rpc('reschedule_checkout_window', [incoming, 0, JSON.stringify(change)]),
    ).rejects.toThrow(/Acesso negado/);
    await asUser(outsider);
    await expect(
      rpc('reschedule_checkout_window', [incoming, 0, JSON.stringify(change)]),
    ).rejects.toThrow(/Acesso negado/);
    await asUser(admin);
    await expect(
      rpc('reschedule_checkout_window', [
        incoming,
        0,
        JSON.stringify({ ...change, checkout_time: '09:00' }),
      ]),
    ).rejects.toThrow(/fim/);
    await rpc('reschedule_checkout_window', [
      incoming,
      0,
      JSON.stringify(change),
    ]);
    const after = (
      await db.query<{
        responses: unknown;
        items: unknown;
        started_at: unknown;
        status: string;
        due_at: Date;
      }>('select * from activities where id=$1', [activity])
    ).rows[0];
    expect(after.responses).toEqual(before.responses);
    expect(after.items).toEqual(before.items);
    expect(after.started_at).toEqual(before.started_at);
    expect(after.status).toBe('in_progress');
    expect(
      (await db.query('select * from service_orders where id=$1', [incoming]))
        .rows[0],
    ).toEqual(inBefore);
    const out = (
      await db.query<{ scheduled_start_at: Date; due_at: Date }>(
        'select * from service_orders where id=$1',
        [outgoing],
      )
    ).rows[0];
    expect(new Date(out.scheduled_start_at).toISOString()).toBe(
      today + 'T13:30:00.000Z',
    );
    expect(new Date(out.due_at).toISOString()).toBe(today + 'T14:45:00.000Z');
    expect(after.due_at).toEqual(out.due_at);
    await expect(
      rpc('reschedule_checkout_window', [incoming, 0, JSON.stringify(change)]),
    ).rejects.toThrow(/alterada/);
    const tomorrow = (
      await db.query<{ date_value: string }>(
        "select to_char((now() at time zone 'America/Sao_Paulo')::date+1,'YYYY-MM-DD') as date_value",
      )
    ).rows[0].date_value;
    await expect(
      rpc('reschedule_checkout_window', [
        incoming,
        1,
        JSON.stringify({ ...change, checkout: tomorrow }),
      ]),
    ).rejects.toThrow(/somente o horário/);
  });
  it('bloqueia ajustes após envio para revisão e mantém a revisão independente', async () => {
    await asUser(worker);
    await action(activity, 'save', {
      responses: { cup: { confirmed: true, found: 4, condition: 'ok' } },
    });
    await action(activity, 'submit');
    await asUser(admin);
    await expect(
      rpc('reschedule_checkout_window', [
        incoming,
        1,
        JSON.stringify({
          checkout: today,
          checkout_start_time: '11:00',
          checkout_time: '12:00',
          reason: 'Tentativa após envio',
        }),
      ]),
    ).rejects.toThrow(/revisão/);
    await action(activity, 'approve');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [outgoing],
        )
      ).rows[0].status,
    ).toBe('approved');
  });
  it('rejeita faixas invertidas na criação sem criar hospedagens ou ordens parciais', async () => {
    await expect(
      rpc('create_scheduled_work_order', [
        JSON.stringify({
          unit_id: target,
          order_type: 'checkin',
          execution_mode: 'task',
          assignee: worker,
          checkout_assignee: worker,
          guest_name: 'Inválido',
          checkin: '2097-01-01',
          duration_nights: 2,
          guests: 2,
          checkin_start_time: '16:00',
          checkin_time: '15:00',
        }),
      ]),
    ).rejects.toThrow(/fim/);
    expect(
      (
        await db.query(
          "select id from reservations where unit_id=$1 and checkin='2097-01-01'",
          [target],
        )
      ).rows,
    ).toHaveLength(0);
  });
});

describe.sequential('modelos nomeados e cópias independentes', () => {
  let from: string,
    to: string,
    first: string,
    other: string,
    edited: string,
    copied: string;
  const publish = (payload: Record<string, unknown>) =>
    rpc('save_named_checklist', [JSON.stringify(payload)]) as Promise<string>;
  it('mantém vários modelos nomeados do mesmo tipo na mesma unidade', async () => {
    await asUser(admin);
    from = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Modelos origem',
        capacity: 6,
        base_occupancy: 2,
      }),
    ])) as string;
    to = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Modelos destino',
        capacity: 6,
        base_occupancy: 2,
      }),
    ])) as string;
    first = await publish({
      unit_id: from,
      name: '  Preparação completa  ',
      items: [sharedCup, sharedTowel, item],
    });
    other = await publish({
      unit_id: from,
      name: 'Preparação rápida',
      items: [sharedTowel],
    });
    const rows = (
      await db.query<{ model_id: string; name: string }>(
        'select model_id,name from checklist_template_versions where id in($1,$2)',
        [first, other],
      )
    ).rows;
    expect(new Set(rows.map((t) => t.model_id)).size).toBe(2);
    expect(rows.map((t) => t.name)).toContain('Preparação completa');
    await expect(
      publish({ unit_id: from, name: 'PREPARAÇÃO COMPLETA', items: [item] }),
    ).rejects.toThrow(/este nome/);
    await expect(
      publish({ unit_id: from, name: ' ', items: [item] }),
    ).rejects.toThrow(/nome/);
  });
  it('edita e renomeia somente o modelo escolhido, sem mudar snapshots ou outro modelo', async () => {
    edited = await publish({
      unit_id: from,
      name: 'Preparação completa revisada',
      kind: 'cleaning',
      base_template_id: first,
      items: [{ ...sharedCup, expected: 8 }, sharedTowel, item],
    });
    const rows = (
      await db.query<{
        id: string;
        model_id: string;
        name: string;
        items: { expected: number }[];
      }>(
        'select id,model_id,name,items from checklist_template_versions where id in($1,$2,$3)',
        [first, edited, other],
      )
    ).rows;
    expect(rows.find((t) => t.id === first)?.items[0].expected).toBe(4);
    expect(rows.find((t) => t.id === edited)?.model_id).toBe(
      rows.find((t) => t.id === first)?.model_id,
    );
    expect(rows.find((t) => t.id === other)?.name).toBe('Preparação rápida');
    await expect(
      publish({
        unit_id: from,
        name: 'Edição atrasada',
        base_template_id: first,
        items: [item],
      }),
    ).rejects.toThrow(/CONFLICT/);
    await expect(
      publish({
        unit_id: to,
        name: 'Base de outra unidade',
        base_template_id: edited,
        items: [item],
      }),
    ).rejects.toThrow(/incompatível/);
  });
  it('duplica para uma unidade que já tem modelo, sem sobrescrever o destino ou a origem', async () => {
    const destination = await publish({
      unit_id: to,
      name: 'Modelo já existente',
      items: [item],
    });
    const source = (
      await db.query<{ items: unknown[] }>(
        'select items from checklist_template_versions where id=$1',
        [edited],
      )
    ).rows[0];
    copied = await publish({
      unit_id: to,
      name: 'Preparação completa',
      source_template_id: edited,
      items: source.items,
    });
    const models = (
      await db.query<{
        id: string;
        model_id: string;
        unit_id: string;
        items: unknown[];
      }>(
        'select id,model_id,unit_id,items from checklist_template_versions where id in($1,$2,$3)',
        [copied, edited, destination],
      )
    ).rows;
    expect(models.find((t) => t.id === copied)?.items).toEqual(source.items);
    expect(models.find((t) => t.id === copied)?.model_id).not.toBe(
      models.find((t) => t.id === edited)?.model_id,
    );
    expect(models.find((t) => t.id === copied)?.unit_id).toBe(to);
    expect(models.find((t) => t.id === destination)?.items).toEqual([item]);
    expect(
      (
        await db.query(
          'select id from audit_events where resource_id=$1 and event=$2',
          [copied, 'checklist.duplicated'],
        )
      ).rows,
    ).toHaveLength(1);
    await publish({
      unit_id: to,
      name: 'Cópia ajustada',
      base_template_id: copied,
      items: [{ ...sharedCup, expected: 1 }],
    });
    expect(
      (
        await db.query<{ items: { expected: number }[] }>(
          'select items from checklist_template_versions where id=$1',
          [edited],
        )
      ).rows[0].items[0].expected,
    ).toBe(8);
  });
  it('aplica permissões nas duas unidades e exige fotos no destino', async () => {
    await asUser(worker);
    await expect(
      publish({
        unit_id: to,
        name: 'Sem permissão',
        source_template_id: edited,
        items: [item],
      }),
    ).rejects.toThrow(/Acesso negado/);
    const foreignUser = '00000000-0000-4000-8000-000000000099';
    await db.exec(
      `reset role; insert into auth.users values('${foreignUser}','external-models@aja.test');`,
    );
    await asUser(foreignUser);
    const foreignOrg = (await rpc('bootstrap', [
      'Outro grupo modelos',
      'Externo',
    ])) as string;
    const foreignProperty = (await rpc('configure', [
      'property',
      JSON.stringify({
        org_id: foreignOrg,
        name: 'Propriedade externa modelos',
      }),
    ])) as string;
    const foreignUnit = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: foreignProperty,
        name: 'Unidade externa modelos',
        capacity: 2,
        base_occupancy: 1,
      }),
    ])) as string;
    const foreignModel = await publish({
      unit_id: foreignUnit,
      name: 'Modelo restrito',
      items: [item],
    });
    await asUser(admin);
    await expect(
      publish({
        unit_id: to,
        name: 'Origem restrita',
        source_template_id: foreignModel,
        items: [item],
      }),
    ).rejects.toThrow(/Acesso negado ao modelo de origem/);
    await expect(
      publish({
        unit_id: to,
        name: 'Foto estrangeira',
        source_template_id: edited,
        items: [{ ...item, reference_path: `${from}/foto` }],
      }),
    ).rejects.toThrow(/Copie as fotos/);
    const withPhoto = await publish({
      unit_id: to,
      name: 'Fotos próprias',
      source_template_id: edited,
      items: [{ ...item, reference_path: `${to}/foto-copiada` }],
    });
    expect(withPhoto).toBeTruthy();
  });
  it('remove todas as versões de um modelo sem remover os outros e permite restaurar', async () => {
    await asUser(admin);
    await rpc('set_checklist_archived', [edited, true]);
    expect(
      (
        await db.query(
          'select id from checklist_template_versions where id in($1,$2) and archived_at is not null',
          [first, edited],
        )
      ).rows,
    ).toHaveLength(2);
    expect(
      (
        await db.query(
          'select id from checklist_template_versions where id in($1,$2) and archived_at is null',
          [other, copied],
        )
      ).rows,
    ).toHaveLength(2);
    await expect(
      publish({
        unit_id: from,
        name: 'Edição de removido',
        base_template_id: edited,
        items: [item],
      }),
    ).rejects.toThrow(/removido/);
    await expect(
      publish({
        unit_id: to,
        name: 'Cópia removida',
        source_template_id: edited,
        items: [item],
      }),
    ).rejects.toThrow(/origem foi removido/);
    await rpc('set_checklist_archived', [edited, false]);
    await expect(rpc('set_checklist_archived', [first, true])).rejects.toThrow(
      /CONFLICT/,
    );
  });
  it('usa o modelo nomeado escolhido para gerar as duas ordens e preserva seu snapshot após edição', async () => {
    await asUser(admin);
    const incoming = (await rpc('create_scheduled_work_order', [
      JSON.stringify({
        unit_id: from,
        order_type: 'checkin',
        execution_mode: 'checklist',
        template_id: edited,
        assignee: admin,
        checkout_assignee: admin,
        guest_name: 'Estadia modelo nomeado',
        checkin: '2098-07-01',
        duration_nights: 2,
        guests: 3,
      }),
    ])) as string;
    const orders = (
      await db.query<{
        template_id: string;
        order_type: string;
        items: { mode: string; expected: number }[];
      }>(
        'select s.template_id,s.order_type,a.items from service_orders s join activities a on a.id=s.activity_id where s.checkin_order_id=$1',
        [incoming],
      )
    ).rows;
    expect(orders).toHaveLength(2);
    expect(orders.every((o) => o.template_id === edited)).toBe(true);
    expect(
      orders
        .find((o) => o.order_type === 'checkout')
        ?.items.map((i) => i.expected),
    ).toEqual([8, 3]);
    await publish({
      unit_id: from,
      name: 'Preparação alterada depois',
      base_template_id: edited,
      items: [sharedCup],
    });
    expect(
      (
        await db.query<{ items: { expected: number }[] }>(
          'select a.items from activities a join service_orders s on s.activity_id=a.id where s.checkin_order_id=$1 and s.order_type=$2',
          [incoming, 'checkout'],
        )
      ).rows[0].items[0].expected,
    ).toBe(8);
  });
});

describe.sequential('envio único, fotos gerais e gestão das ordens', () => {
  let executionUnit: string,
    root: string,
    out: string,
    inActivity: string,
    outActivity: string,
    arrival: string,
    replacement: string;
  const tokenIn = '00000000-0000-4000-8000-000000000301',
    tokenOut = '00000000-0000-4000-8000-000000000302';
  const revision = async (id: string, table = 'activities') =>
    (
      await db.query<{ revision: number }>(
        `select revision from ${table} where id=$1`,
        [id],
      )
    ).rows[0].revision;
  const submit = async (
    id: string,
    responses: unknown,
    token: string,
    rev?: number,
  ) =>
    rpc('submit_checklist', [
      id,
      rev ?? (await revision(id)),
      token,
      JSON.stringify(responses),
    ]);
  const manage = async (
    id: string,
    action: string,
    payload: unknown = { reason: 'Ajuste solicitado pela gestão' },
    rev?: number,
  ) =>
    rpc('manage_work_order', [
      id,
      rev ?? (await revision(id, 'service_orders')),
      action,
      JSON.stringify(payload),
    ]);
  const photo = async (id: string, file = crypto.randomUUID()) => {
    await asUser(worker);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('evidence',$1)",
      [`${id}/${file}`],
    );
    await receive(id, '__activity__', file, 'a'.repeat(64));
    return file;
  };
  const answers = (found = 4) => ({
    cup: {
      confirmed: true,
      found,
      condition: 'ok',
      ...(found !== 4 ? { note: 'Falta um copo na cozinha' } : {}),
    },
    'towel-shared': { confirmed: true, found: 2, condition: 'ok' },
  });
  it('envia respostas e uma foto geral para todos os itens em uma transação idempotente', async () => {
    await asUser(admin);
    executionUnit = (await rpc('configure', [
      'unit',
      JSON.stringify({
        property_id: property,
        name: 'Execução simplificada',
        capacity: 6,
        base_occupancy: 2,
      }),
    ])) as string;
    const model = (await rpc('save_named_checklist', [
      JSON.stringify({
        unit_id: executionUnit,
        name: 'Conferência padrão',
        items: [
          { ...sharedCup, evidence_required: true },
          { ...sharedTowel, evidence_required: true },
          { ...item, id: 'technical', mode: 'technical' },
        ],
      }),
    ])) as string;
    const dates = (
      await db.query<{ arrival: string; departure: string }>(
        "select ((now() at time zone 'America/Sao_Paulo')::date-1)::text arrival, (now() at time zone 'America/Sao_Paulo')::date::text departure",
      )
    ).rows[0];
    arrival = dates.arrival;
    root = (await rpc('create_scheduled_work_order', [
      JSON.stringify({
        unit_id: executionUnit,
        order_type: 'checkin',
        execution_mode: 'checklist',
        template_id: model,
        assignee: worker,
        checkout_assignee: worker,
        guest_name: 'Estadia execução',
        checkin: dates.arrival,
        duration_nights: 1,
        guests: 2,
      }),
    ])) as string;
    const orders = (
      await db.query<{ id: string; activity_id: string; order_type: string }>(
        'select id,activity_id,order_type from service_orders where checkin_order_id=$1',
        [root],
      )
    ).rows;
    inActivity = orders.find((o) => o.order_type === 'checkin')!.activity_id;
    out = orders.find((o) => o.order_type === 'checkout')!.id;
    outActivity = orders.find((o) => o.order_type === 'checkout')!.activity_id;
    await asUser(worker);
    await action(inActivity, 'start');
    await expect(submit(inActivity, {}, tokenIn)).rejects.toThrow(/Confira/);
    const before = (
      await db.query<{ responses: unknown; execution_version: number }>(
        'select responses,execution_version from activities where id=$1',
        [inActivity],
      )
    ).rows[0];
    expect(before).toEqual({ responses: {}, execution_version: 1 });
    const checked = {
      cup: { confirmed: true },
      'towel-shared': { confirmed: true },
      technical: { confirmed: true },
    };
    await expect(submit(inActivity, checked, tokenIn)).rejects.toThrow(/foto/);
    await photo(inActivity);
    const beforeRevision = await revision(inActivity);
    await submit(inActivity, checked, tokenIn, beforeRevision);
    const sent = (
      await db.query<{ status: string; responses: Record<string, unknown> }>(
        'select status,responses from activities where id=$1',
        [inActivity],
      )
    ).rows[0];
    expect(sent.status).toBe('review');
    expect(sent.responses.cup).toMatchObject({
      confirmed: true,
      found: 4,
      condition: 'ok',
    });
    expect(sent.responses.technical).toMatchObject({
      confirmed: true,
      answer: 'ok',
    });
    const after = await revision(inActivity);
    await submit(inActivity, checked, tokenIn, beforeRevision);
    expect(await revision(inActivity)).toBe(after);
    expect(
      (
        await db.query(
          'select id from checklist_review_cycles where activity_id=$1',
          [inActivity],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      submit(inActivity, checked, crypto.randomUUID(), beforeRevision),
    ).rejects.toThrow(/CONFLICT/);
    await asUser(admin);
    await manage(root, 'status', {
      status: 'approved',
      reason: 'Conferência aprovada pela gestão',
    });
    expect(
      (
        await db.query<{ status: string }>(
          'select status from activities where id=$1',
          [inActivity],
        )
      ).rows[0].status,
    ).toBe('completed');
  });
  it('limita a oito fotos, permite repetir o recibo e calcula divergência no servidor', async () => {
    await asUser(worker);
    await action(outActivity, 'start');
    let last = '';
    for (let i = 0; i < 8; i++) last = await photo(outActivity);
    await receive(outActivity, '__activity__', last, 'a'.repeat(64));
    const ninth = crypto.randomUUID();
    await db.query(
      "insert into storage.objects(bucket_id,name) values('evidence',$1)",
      [`${outActivity}/${ninth}`],
    );
    await expect(
      receive(outActivity, '__activity__', ninth, 'a'.repeat(64)),
    ).rejects.toThrow(/8 fotos/);
    expect(
      (
        await db.query('select id from evidence_files where activity_id=$1', [
          outActivity,
        ])
      ).rows,
    ).toHaveLength(8);
    await expect(
      submit(
        outActivity,
        { ...answers(3), cup: { confirmed: true, found: 3, condition: 'ok' } },
        tokenOut,
      ),
    ).rejects.toThrow(/Descreva a divergência/);
    expect(
      (
        await db.query<{ responses: unknown }>(
          'select responses from activities where id=$1',
          [outActivity],
        )
      ).rows[0].responses,
    ).toEqual({});
    await submit(outActivity, answers(3), tokenOut);
    expect(
      (
        await db.query<{ responses: Record<string, unknown> }>(
          'select responses from activities where id=$1',
          [outActivity],
        )
      ).rows[0].responses.cup,
    ).toMatchObject({ condition: 'divergent', confirmed: true, found: 3 });
  });
  it('exige foto nova na correção e mantém bloqueados os itens que já estavam aprovados', async () => {
    await asUser(admin);
    await action(outActivity, 'reject', {
      reason: 'Refazer a contagem dos copos',
      items: ['cup'],
    });
    await asUser(worker);
    const retained = (
      await db.query<{ responses: Record<string, unknown> }>(
        'select responses from activities where id=$1',
        [outActivity],
      )
    ).rows[0].responses;
    const corrected = {
      ...retained,
      cup: { confirmed: true, found: 4, condition: 'ok' },
    };
    const token = crypto.randomUUID();
    await expect(submit(outActivity, corrected, token)).rejects.toThrow(/foto/);
    await photo(outActivity);
    await expect(
      submit(
        outActivity,
        {
          ...corrected,
          'towel-shared': {
            confirmed: true,
            found: 1,
            condition: 'divergent',
            note: 'Não pode mudar este item',
          },
        },
        token,
      ),
    ).rejects.toThrow(/somente os itens/);
    await submit(outActivity, corrected, token);
    await expect(
      manage(out, 'status', {
        status: 'approved',
        reason: 'Tentativa de aprovar a própria execução',
      }),
    ).rejects.toThrow(/somente administrador/);
    await asUser(admin);
    await manage(out, 'status', {
      status: 'approved',
      reason: 'Correção conferida pela gestão',
    });
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [out],
        )
      ).rows[0].status,
    ).toBe('approved');
  });
  it('permite reabrir pelo gestor preservando a aprovação anterior e editar a nova tentativa', async () => {
    await asUser(admin);
    await manage(root, 'status', {
      status: 'in_progress',
      reason: 'Reabrir para uma nova conferência',
    });
    const row = (
      await db.query<{
        attempt: number;
        manager_reopened: boolean;
        responses: Record<string, unknown>;
      }>(
        'select attempt,manager_reopened,responses from activities where id=$1',
        [inActivity],
      )
    ).rows[0];
    expect(row.attempt).toBe(2);
    expect(row.manager_reopened).toBe(true);
    expect(
      (
        await db.query<{ decision: string }>(
          'select decision from checklist_review_cycles where activity_id=$1 and attempt=1',
          [inActivity],
        )
      ).rows[0].decision,
    ).toBe('approved');
    await photo(inActivity);
    await submit(
      inActivity,
      {
        ...row.responses,
        cup: {
          confirmed: true,
          found: 5,
          condition: 'ok',
          note: 'Um copo extra disponível',
        },
      },
      crypto.randomUUID(),
    );
    await asUser(admin);
    await manage(root, 'status', {
      status: 'approved',
      reason: 'Nova conferência aprovada',
    });
    expect(
      (
        await db.query(
          'select id from checklist_review_cycles where activity_id=$1',
          [inActivity],
        )
      ).rows,
    ).toHaveLength(2);
  });
  it('exclui o check-in e seu checkout juntos com controle de acesso, revisão e histórico', async () => {
    await asUser(worker);
    await expect(manage(root, 'delete')).rejects.toThrow(
      /somente administrador/,
    );
    await asUser(admin);
    await expect(
      manage(root, 'delete', {}, await revision(root, 'service_orders')),
    ).rejects.toThrow(/motivo/);
    await expect(
      manage(root, 'delete', { reason: 'Excluir hospedagem de teste' }, -1),
    ).rejects.toThrow(/CONFLICT/);
    const before = (
      await db.query<{ responses: unknown }>(
        'select responses from activities where id=$1',
        [inActivity],
      )
    ).rows[0].responses;
    await manage(root, 'delete', {
      reason: 'Hospedagem cancelada antes da próxima operação',
    });
    expect(
      (
        await db.query(
          'select id from service_orders where checkin_order_id=$1 and deleted_at is not null',
          [root],
        )
      ).rows,
    ).toHaveLength(2);
    expect(
      (await db.query('select id from team_agenda where id=$1', [root])).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query<{ responses: unknown }>(
          'select responses from activities where id=$1',
          [inActivity],
        )
      ).rows[0].responses,
    ).toEqual(before);
    expect(
      (
        await db.query('select id from evidence_files where activity_id=$1', [
          outActivity,
        ])
      ).rows,
    ).toHaveLength(9);
    await asUser(worker);
    expect(
      (
        await db.query(
          'select id from service_orders where checkin_order_id=$1',
          [root],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('select id from activities where id=$1', [inActivity]))
        .rows,
    ).toHaveLength(0);
    await expect(action(inActivity, 'start')).rejects.toThrow();
    await asUser(admin);
    replacement = (await rpc('create_scheduled_work_order', [
      JSON.stringify({
        unit_id: executionUnit,
        order_type: 'checkin',
        execution_mode: 'task',
        assignee: worker,
        checkout_assignee: worker,
        guest_name: 'Outra estadia nas datas liberadas',
        checkin: arrival,
        duration_nights: 1,
        guests: 2,
      }),
    ])) as string;
  });
  it('restaura o mesmo par como pendente, mas impede restaurar sobre uma nova hospedagem', async () => {
    await asUser(admin);
    await expect(manage(root, 'restore')).rejects.toThrow(/conflitam/);
    await manage(replacement, 'delete', {
      reason: 'Remover a hospedagem substituta',
    });
    await manage(root, 'restore', {
      reason: 'Restaurar a hospedagem original',
    });
    const restored = (
      await db.query<{ id: string; status: string; deleted_at: string | null }>(
        'select id,status,deleted_at from service_orders where checkin_order_id=$1',
        [root],
      )
    ).rows;
    expect(restored).toHaveLength(2);
    expect(
      restored.every((s) => s.status === 'assigned' && s.deleted_at === null),
    ).toBe(true);
    expect(
      (await db.query('select id from team_agenda where id=$1', [root])).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query('select id from evidence_files where activity_id=$1', [
          outActivity,
        ])
      ).rows,
    ).toHaveLength(9);
  });
  it('permite gerir também tarefas simples e bloqueia revisão sem evidências ou aprovação pelo próprio executor', async () => {
    await asUser(admin);
    const task = (await rpc('create_scheduled_work_order', [
      JSON.stringify({
        unit_id: executionUnit,
        order_type: 'general',
        execution_mode: 'task',
        assignee: worker,
        title: 'Conferir fechadura',
        due_at: '2026-10-15T18:00:00Z',
        occupancy: 2,
      }),
    ])) as string;
    await manage(task, 'status', {
      status: 'in_progress',
      reason: 'Iniciar tarefa pela gestão',
    });
    await expect(
      manage(task, 'status', {
        status: 'review',
        reason: 'Encaminhar sem evidência',
      }),
    ).rejects.toThrow(/conclusão e a foto/);
    await manage(task, 'status', {
      status: 'cancelled',
      reason: 'Serviço deixou de ser necessário',
    });
    await manage(task, 'delete', {
      reason: 'Remover serviço que foi cancelado',
    });
    await manage(task, 'restore');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from service_orders where id=$1',
          [task],
        )
      ).rows[0].status,
    ).toBe('assigned');
    const own = (await rpc('create_scheduled_work_order', [
      JSON.stringify({
        unit_id: executionUnit,
        order_type: 'general',
        execution_mode: 'task',
        assignee: admin,
        title: 'Tarefa do próprio gestor',
        due_at: '2026-10-15T18:00:00Z',
        occupancy: 2,
      }),
    ])) as string;
    await expect(
      manage(own, 'status', {
        status: 'approved',
        reason: 'Autoaprovação não permitida',
      }),
    ).rejects.toThrow(/Autoaprovação/);
  });
});
