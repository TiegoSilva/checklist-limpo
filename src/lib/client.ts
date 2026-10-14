import { createClient } from '@supabase/supabase-js';
import { openDB } from 'idb';
import { emptyData, type Data, type Response } from '../domain';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key && !url.includes('SEU-PROJETO'));
export const supabase = configured ? createClient(url, key) : null;
export async function loadData(): Promise<Data> {
  if (!supabase) return emptyData;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Entre novamente para continuar.');
  if (!navigator.onLine) {
    const cached = (await (
      await db()
    ).get('drafts', `snapshot:${session.user.id}`)) as Data | undefined;
    if (cached) return cached;
    throw new Error('Sem conexão e sem atividades salvas neste dispositivo.');
  }
  const tables = Object.keys(emptyData) as (keyof Data)[];
  let agendaReady = true;
  const result = await Promise.all(
    tables.map(async (table) => {
      const { data, error } = await supabase!
        .from(table)
        .select('*')
        .limit(1000);
      if (
        error &&
        table === 'team_agenda' &&
        ['PGRST205', '42P01'].includes(error.code)
      ) {
        agendaReady = false;
        return [table, []] as const;
      }
      if (error) throw new Error(`${table}: ${error.message}`);
      return [table, data] as const;
    }),
  );
  const data = Object.fromEntries(result) as Data;
  data.agenda_ready = agendaReady;
  // Cache mínimo por usuário. Dados de hóspedes, notificações e auditoria não são persistidos.
  const local = {
    ...emptyData,
    profiles: data.profiles.filter((p) => p.id === session.user.id),
    memberships: data.memberships.filter((m) => m.user_id === session.user.id),
    organizations: data.organizations,
    units: data.units,
    properties: data.properties,
    team_agenda: data.team_agenda,
    agenda_ready: agendaReady,
    service_orders: data.service_orders.filter(
      (s) =>
        s.assignee === session.user.id &&
        !['approved', 'cancelled'].includes(s.status),
    ),
    activities: data.activities.filter(
      (a) =>
        a.assignee === session.user.id &&
        !['completed', 'cancelled'].includes(a.status),
    ),
  };
  await (await db()).put('drafts', local, `snapshot:${session.user.id}`);
  return data;
}
export async function rpc(name: string, args: Record<string, unknown> = {}) {
  if (!supabase)
    throw new Error('Configure o Supabase para gravar dados reais.');
  if (!navigator.onLine)
    throw new Error(
      'Sem conexão. Salve o rascunho neste dispositivo e envie quando estiver online.',
    );
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (name === 'create_work_order' && error.code === 'PGRST202') {
      throw new Error(
        'Aplique a migração 202610140007_work_orders.sql no Supabase para ativar as ordens com modelos e o checkout vinculado.',
      );
    }
    if (
      ['register_checkin', 'reschedule_checkout'].includes(name) &&
      error.code === 'PGRST202'
    ) {
      throw new Error(
        'Aplique a migração 202610140006_stay_agenda.sql no Supabase para ativar a agenda e o checkout automático.',
      );
    }
    if (name === 'save_checklist' && error.code === 'PGRST202') {
      throw new Error(
        'Atualização do banco pendente. Aplique a migração 202610140005_shared_checklist_items.sql no Supabase antes de salvar os checklists.',
      );
    }
    throw new Error(error.message);
  }
  return data;
}
export type Draft = {
  revision: number;
  responses: Record<string, Response>;
  savedAt: string;
};
const db = () =>
  openDB('aja-private-drafts', 1, {
    upgrade(db) {
      db.createObjectStore('drafts');
    },
  });
export const saveDraft = async (
  user: string,
  activity: string,
  draft: Draft,
) => {
  await (await db()).put('drafts', draft, `${user}:${activity}`);
};
export const getDraft = async (
  user: string,
  activity: string,
): Promise<Draft | undefined> =>
  (await db()).get('drafts', `${user}:${activity}`);
export const removeDraft = async (user: string, activity: string) => {
  await (await db()).delete('drafts', `${user}:${activity}`);
};
export const clearDrafts = async () => {
  await (await db()).clear('drafts');
};
export async function uploadEvidence(
  activity: string,
  item: string,
  file: File,
) {
  return uploadPhoto('activity', activity, file, item);
}
export async function uploadPhoto(
  kind: 'activity' | 'service',
  resource: string,
  file: File,
  item?: string,
) {
  if (!supabase) throw new Error('Configure o Supabase.');
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Use uma foto JPG, PNG ou WebP de até 10 MB.');
  const id = crypto.randomUUID();
  const path = `${resource}/${id}`;
  const { error } = await supabase.storage
    .from(kind === 'activity' ? 'evidence' : 'service-evidence')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Entre novamente.');
  const receipt = await fetch('/api/evidence', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ resource, item, file_id: id, kind }),
  });
  const result = await receipt.json();
  if (!receipt.ok)
    throw new Error(
      result.error ??
        'A foto foi enviada, mas não foi confirmada. Tente novamente.',
    );
}
export async function signedImage(
  bucket: 'references' | 'evidence' | 'service-evidence',
  path: string,
) {
  if (!supabase) throw new Error('Configure o Supabase.');
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

export type Run = (
  fn: () => Promise<unknown>,
  success?: string,
) => Promise<boolean>;
