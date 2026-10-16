import { mediaError } from './media';
import { Upload } from 'tus-js-client';
import { OperationError, readApiResponse, describeError } from './errors';
import { collectPages } from './pagination';
import { createClient } from '@supabase/supabase-js';
import { openDB } from 'idb';
import { emptyData, type Data, type Response } from '../domain';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
let pushWake: ReturnType<typeof setTimeout> | undefined;
export const configured = Boolean(url && key && !url.includes('SEU-PROJETO'));
export const supabase = configured ? createClient(url, key) : null;
export async function loadData(
  property = '',
  includeAudit = false,
  includeHistory = true,
): Promise<Data> {
  if (!supabase) return emptyData;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Entre novamente para continuar.');
  if (!navigator.onLine) {
    const cached = (await (
      await db()
    ).get('drafts', `snapshot:${session.user.id}:${property || 'all'}`)) as
      Data | undefined;
    if (cached) return cached;
    throw new Error('Sem conexão e sem atividades salvas neste dispositivo.');
  }
  const tables = Object.keys(emptyData) as (keyof Data)[];
  let agendaReady = true;
  const result = await Promise.all(
    tables.map(async (table) => {
      if (table === 'audit_events' && !includeAudit)
        return [table, []] as const;
      const failures: { code: string; message: string }[] = [];
      const data = await collectPages(async (offset, size) => {
        const serverPage = await supabase!.rpc('operation_page', {
          resource: table,
          property_id: [
            'activities',
            'service_orders',
            'stays',
            'preparation_cycles',
            'team_agenda',
            'audit_events',
            'evidence_files',
            'checklist_review_cycles',
            'findings',
            'service_evidence',
          ].includes(table)
            ? property || null
            : null,
          page_offset: offset,
          page_size: size,
          open_only: !includeHistory,
        });
        if (!serverPage.error)
          return {
            rows: (serverPage.data.rows ?? []) as Record<string, unknown>[],
            total: serverPage.data.total as number,
          };
        if (serverPage.error.code !== 'PGRST202') {
          failures.push(serverPage.error);
          return { rows: [], total: 0 };
        }
        // Compatibilidade durante a aplicação da migração 015: ainda pagina a consulta antiga.
        let query = supabase!.from(table).select('*', { count: 'exact' });
        if (table === 'memberships')
          query = query.order('org_id').order('user_id');
        else query = query.order('id');
        const result = await query.range(offset, offset + size - 1);
        if (result.error) {
          failures.push(result.error);
          return { rows: [], total: 0 };
        }
        return { rows: result.data ?? [], total: result.count };
      });
      const error = failures[0];
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
  data.activities = data.activities.filter((a) => !a.deleted_at);
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
  await (
    await db()
  ).put('drafts', local, `snapshot:${session.user.id}:${property || 'all'}`);
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
    if (
      [
        'submit_checklist_with_evidence',
        'expect_evidence_uploads',
        'cancel_evidence_upload',
        'pending_evidence_uploads',
        'save_location',
        'save_inventory_batch',
        'read_notifications',
      ].includes(name) &&
      error.code === 'PGRST202'
    )
      throw new Error(
        'Atualização do sistema pendente: aplique a migração 202610160015_operational_improvements.sql no Supabase antes de usar esta ação.',
      );
    if (name === 'save_inventory_item' && error.code === 'PGRST202') {
      throw new Error(
        'Atualização do inventário pendente. Aplique a migração 202610160014_inventory_links.sql no Supabase para cadastrar e editar os itens vinculados às unidades.',
      );
    }
    if (
      ['activity_action', 'service_action', 'manage_work_order'].includes(
        name,
      ) &&
      /Autoaprova/i.test(error.message)
    ) {
      throw new Error(
        'Aplique a migração 202610150012_manager_review.sql no Supabase para permitir a revisão da própria execução por gestores.',
      );
    }
    if (
      ['submit_checklist', 'manage_work_order'].includes(name) &&
      error.code === 'PGRST202'
    ) {
      throw new Error(
        'Aplique a migração 202610150011_execution_and_order_management.sql no Supabase para ativar a execução simplificada e a gestão das ordens.',
      );
    }
    if (name === 'save_named_checklist' && error.code === 'PGRST202') {
      throw new Error(
        'Aplique a migração 202610150010_named_checklist_models.sql no Supabase para nomear e duplicar modelos.',
      );
    }
    if (
      ['create_scheduled_work_order', 'reschedule_checkout_window'].includes(
        name,
      ) &&
      error.code === 'PGRST202'
    ) {
      throw new Error(
        'Aplique a migração 202610150009_checkin_execution_windows.sql no Supabase para ativar os horários e o checkout derivado do check-in.',
      );
    }
    if (name === 'set_checklist_archived' && error.code === 'PGRST202') {
      throw new Error(
        'Aplique a migração 202610150008_archive_checklists.sql no Supabase para remover e restaurar modelos.',
      );
    }
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
  if (
    import.meta.env.VITE_VAPID_PUBLIC_KEY &&
    ![
      'read_notification',
      'read_notifications',
      'expect_evidence_uploads',
      'cancel_evidence_upload',
      'pending_evidence_uploads',
      'unsubscribe_push',
    ].includes(name)
  ) {
    const wake = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session)
          await fetch('/api/notifications', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
            keepalive: true,
          });
      } catch {
        /* A gravação já foi confirmada; a fila mantém a entrega para nova tentativa. */
      }
    };
    void wake();
    clearTimeout(pushWake);
    pushWake = setTimeout(() => void wake(), 16000);
  }
  return data;
}
export type Draft = {
  revision: number;
  responses: Record<string, Response>;
  savedAt: string;
  photos?: ExecutionPhoto[];
  submissionId?: string;
  attempt?: number;
  cancelledFiles?: string[];
};
export type UploadProgress = {
  percent: number;
  phase: 'upload' | 'receipt' | 'complete';
};
export type ExecutionPhoto = { id: string; file: File; uploaded?: boolean };
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
  fileId?: string,
  onProgress?: (progress: UploadProgress) => void,
) {
  if (!supabase) throw new Error('Configure o Supabase.');
  const invalid = mediaError(file);
  if (invalid) throw new Error(invalid);
  const id = fileId ?? crypto.randomUUID();
  const path = `${resource}/${id}`;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Entre novamente.');
  const bucket = kind === 'activity' ? 'evidence' : 'service-evidence';
  const plan = await supabase.rpc('expect_evidence_uploads', {
    kind,
    resource,
    files: [id],
  });
  if (plan.error)
    throw new OperationError(
      'EVIDENCE_QUEUE',
      `Arquivo “${file.name}”: ${plan.error.code === 'PGRST202' ? 'aplique a migração 015 para ativar o controle de uploads.' : plan.error.message}`,
    );
  const confirm = async () => {
    onProgress?.({ percent: 100, phase: 'receipt' });
    const currentSession = (await supabase!.auth.getSession()).data.session;
    if (!currentSession)
      throw new OperationError(
        'SESSION_EXPIRED',
        'Entre novamente para confirmar o arquivo.',
      );
    const receipt = await fetch('/api/evidence', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentSession.access_token}`,
      },
      body: JSON.stringify({ resource, item, file_id: id, kind }),
    });
    const result = await readApiResponse(receipt);
    if (result.confirmed !== true || result.file_id !== id)
      throw new OperationError(
        'RECEIPT_MISSING',
        'O servidor não confirmou o recebimento deste arquivo.',
      );
    onProgress?.({ percent: 100, phase: 'complete' });
  };
  // Verifica objeto existente sem sobrescrever: uma confirmação pode ter falhado após o upload.
  const existing = fileId
    ? await supabase.storage
        .from(bucket)
        .list(resource, { search: id, limit: 1 })
    : null;
  if (existing?.data?.some((object) => object.name === id)) {
    try {
      await confirm();
      return;
    } catch (error) {
      throw new OperationError(
        'EVIDENCE_RECEIPT',
        `Arquivo “${file.name}”: falha ao confirmar recebimento. ${describeError(error)}`,
      );
    }
  }
  onProgress?.({ percent: 0, phase: 'upload' });
  try {
    const storageUrl = new URL(url);
    if (storageUrl.hostname.endsWith('.supabase.co'))
      storageUrl.hostname = storageUrl.hostname.replace(
        '.supabase.co',
        '.storage.supabase.co',
      );
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint: `${storageUrl.origin}/storage/v1/upload/resumable`,
        headers: {
          authorization: `Bearer ${session.access_token}`,
          apikey: key,
          'x-upsert': 'false',
        },
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        fingerprint: async () =>
          `aja:${session.user.id}:${bucket}:${path}:${file.size}:${file.lastModified}`,
        metadata: {
          bucketName: bucket,
          objectName: path,
          contentType: file.type,
          cacheControl: '3600',
        },
        onProgress: (sent, total) =>
          onProgress?.({
            percent: Math.floor((sent / total) * 100),
            phase: 'upload',
          }),
        onError: reject,
        onSuccess: () => resolve(),
      });
      void upload
        .findPreviousUploads()
        .then((previous) => {
          if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
          upload.start();
        })
        .catch(() => upload.start());
    });
  } catch (error) {
    // O servidor pode ter recebido o último bloco antes de a conexão cair.
    try {
      await confirm();
      return;
    } catch {
      /* O erro de envio mantém o contexto original. */
    }
    throw new OperationError(
      'EVIDENCE_UPLOAD',
      `Não foi possível enviar “${file.name}”. ${describeError(error)} Confira também o limite global do Storage no Supabase.`,
    );
  }
  try {
    await confirm();
  } catch (error) {
    throw new OperationError(
      'EVIDENCE_RECEIPT',
      `Arquivo “${file.name}”: upload realizado, mas recebimento não confirmado. ${describeError(error)}`,
    );
  }
}
export async function signedImage(
  bucket: 'references' | 'evidence' | 'service-evidence',
  path: string,
  expires = 120,
) {
  if (!supabase) throw new Error('Configure o Supabase.');
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expires);
  if (error) throw error;
  return data.signedUrl;
}

export type Run = (
  fn: () => Promise<unknown>,
  success?: string,
) => Promise<boolean>;

export async function loadReportPeriod(
  property: string,
  from: string,
  to: string,
  criterion: string,
) {
  if (!supabase) return null;
  const read = async (resource: 'activities' | 'service_orders') =>
    collectPages(async (position, page_size) => {
      const { data, error } = await supabase!.rpc('operation_page', {
        resource,
        property_id: property || null,
        page_offset: position,
        page_size,
        from_date: from,
        to_date: to,
        criterion,
      });
      if (error)
        throw new Error(
          error.code === 'PGRST202'
            ? 'Aplique a migração 015 para consultar o período no servidor.'
            : error.message,
        );
      return {
        rows: data.rows as Record<string, unknown>[],
        total: data.total as number,
      };
    });
  const [activities, service_orders] = await Promise.all([
    read('activities'),
    read('service_orders'),
  ]);
  return {
    activities: activities as unknown as Data['activities'],
    service_orders: service_orders as unknown as Data['service_orders'],
  };
}
