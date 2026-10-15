import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  itemResponse,
  updateItemResponse,
  sendExecution,
} from '../src/features/execution';
import ActivityDetail from '../src/features/ActivityDetail';
import ExecutionPhotos from '../src/features/ExecutionPhotos';
import OrderManagement from '../src/features/OrderManagement';
import {
  emptyData,
  type Item,
  type Activity,
  type Service,
} from '../src/domain';
import type { Draft } from '../src/lib/client';
import { Modal } from '../src/components';
import ExecutionSummary from '../src/features/ExecutionSummary';
import OrderStayContext from '../src/features/OrderStayContext';
const item: Item = {
  id: 'cup',
  title: 'Copos',
  room: 'Cozinha',
  mode: 'count',
  required: true,
  evidence_required: true,
  expected: 4,
};
const activity: Activity = {
  id: 'activity',
  unit_id: 'unit',
  cycle_id: 'cycle',
  kind: 'cleaning',
  title: 'Check-in',
  assignee: 'person',
  status: 'in_progress',
  priority: 'normal',
  due_at: '2026-10-15T18:00:00Z',
  occupancy: 2,
  items: [item, { ...item, id: 'bed', title: 'Conferir cama', mode: 'task' }],
  responses: {},
  revision: 1,
  attempt: 1,
  created_at: '2026-10-15T12:00:00Z',
};
describe('execução simplificada e retomada', () => {
  it('começa conforme sem considerar o item conferido e mantém o check após mudar quantidades', () => {
    const initial = itemResponse(item);
    expect(initial).toMatchObject({
      confirmed: false,
      found: 4,
      condition: 'ok',
    });
    const checked = updateItemResponse(item, initial, { confirmed: true });
    expect(checked.confirmed).toBe(true);
    const divergent = updateItemResponse(item, checked, { found: 3 });
    expect(divergent).toMatchObject({
      confirmed: true,
      condition: 'divergent',
    });
    expect(updateItemResponse(item, divergent, { found: 4 })).toMatchObject({
      confirmed: true,
      condition: 'ok',
    });
    expect(
      updateItemResponse(item, divergent, { confirmed: false }),
    ).toMatchObject({ confirmed: false, condition: 'divergent' });
    expect(
      updateItemResponse(item, checked, { condition: 'damaged' }).condition,
    ).toBe('damaged');
    expect(
      updateItemResponse(item, checked, { condition: 'divergent' }).condition,
    ).toBe('ok');
  });
  it('exibe somente três condições e as duas ações finais, sem upload por tarefa', () => {
    const html = renderToStaticMarkup(
      <ActivityDetail
        activity={activity}
        data={emptyData}
        user="person"
        manager={false}
        busy={false}
        run={vi.fn()}
        onClose={vi.fn()}
        unitName={() => 'Apartamento'}
        person={() => 'Colaborador'}
      />,
    );
    expect(html).toContain('Salvar Rascunho');
    expect(html).toContain('Enviar para aprovação');
    expect(html).not.toMatch(
      /Enviar progresso|Salvar no dispositivo|Anexar foto obrigatória|Deslocado de ambiente|Quebrado/,
    );
    expect(html).toContain('option value="ok" selected=""');
    expect(html.match(/<option/g)).toHaveLength(3);
    const photos = renderToStaticMarkup(
      <ExecutionPhotos
        photos={[]}
        evidence={[]}
        attempt={1}
        editable
        onChange={vi.fn()}
        onError={vi.fn()}
        onView={vi.fn()}
      />,
    );
    expect(photos.match(/type="file"/g)).toHaveLength(1);
    expect(photos).toContain('capture="environment"');
    expect(photos).toContain('multiple=""');
    expect(photos).toContain('0/8');
  });
  const draft = (): Draft => ({
    revision: 1,
    attempt: 1,
    submissionId: 'send-once',
    responses: { cup: { confirmed: true, found: 4, condition: 'ok' } },
    savedAt: '2026-10-15T12:00:00Z',
    photos: [
      { id: 'photo-1', file: new File(['a'], 'a.jpg', { type: 'image/jpeg' }) },
      { id: 'photo-2', file: new File(['b'], 'b.jpg', { type: 'image/jpeg' }) },
    ],
  });
  it('retoma após falha no upload, mantendo respostas, arquivos e IDs sem repetir fotos confirmadas', async () => {
    let saved = draft();
    const persist = vi.fn(async (d: Draft) => {
      saved = { ...d, photos: d.photos?.map((p) => ({ ...p })) };
    });
    const upload = vi.fn(async (p) => {
      if (p.id === 'photo-2') throw new Error('Sem conexão');
    });
    const submit = vi.fn();
    await expect(
      sendExecution(saved, { persist, upload, submit }),
    ).rejects.toThrow('Sem conexão');
    expect(saved.photos?.map((p) => p.uploaded)).toEqual([true, undefined]);
    expect(saved.responses.cup.confirmed).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    const resumedUpload = vi.fn(async () => {});
    await sendExecution(saved, { persist, upload: resumedUpload, submit });
    expect(resumedUpload).toHaveBeenCalledTimes(1);
    expect(resumedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'photo-2' }),
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 'send-once' }),
    );
  });
  it('mantém todas as fotos no rascunho após erro da submissão e reenvia com o mesmo identificador', async () => {
    let saved = draft();
    const persist = vi.fn(async (d: Draft) => {
      saved = { ...d, photos: d.photos?.map((p) => ({ ...p })) };
    });
    const upload = vi.fn(async () => {});
    await expect(
      sendExecution(saved, {
        persist,
        upload,
        submit: vi.fn().mockRejectedValue(new Error('Servidor indisponível')),
      }),
    ).rejects.toThrow('Servidor indisponível');
    expect(saved.photos?.every((p) => p.uploaded)).toBe(true);
    const retry = vi.fn();
    await sendExecution(saved, { persist, upload, submit: retry });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 'send-once',
        responses: saved.responses,
      }),
    );
  });
  it('não inicia o envio se o rascunho com os arquivos não puder ser preservado', async () => {
    const upload = vi.fn(),
      submit = vi.fn();
    await expect(
      sendExecution(draft(), {
        persist: vi.fn().mockRejectedValue(new Error('Armazenamento cheio')),
        upload,
        submit,
      }),
    ).rejects.toThrow('Armazenamento cheio');
    expect(upload).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('oferece todos os status ao gestor e informa exclusão conjunta do checkout', () => {
    const order = {
      id: 'order',
      status: 'assigned',
      order_type: 'checkin',
      revision: 0,
    } as Service;
    const html = renderToStaticMarkup(
      <OrderManagement order={order} run={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(html).toContain('Gerenciar ordem de serviço');
    expect(html.match(/<option/g)).toHaveLength(6);
    expect(html).toContain('Excluir ordem');
  });
});

it('mostra o contexto da ordem em um resumo único, sem repetir ocupação e programação', () => {
  const data = {
    ...emptyData,
    service_orders: [
      {
        id: 'checkin',
        unit_id: 'unit',
        activity_id: activity.id,
        template_id: 'model',
        reservation_id: 'stay',
        order_type: 'checkin',
        checkin_order_id: 'checkin',
        scheduled_start_at: '2026-10-15T16:30:00Z',
        due_at: '2026-10-15T18:00:00Z',
        status: 'review',
        title: 'Check-in',
        description: '',
        priority: 'normal',
        assignee: 'person',
        blocking: false,
        revision: 1,
      } as Service,
    ],
    checklist_template_versions: [
      {
        id: 'model',
        unit_id: 'unit',
        kind: 'cleaning',
        name: 'Preparação completa',
        version: 3,
        items: [item],
      },
    ],
    team_agenda: [
      {
        id: 'stay',
        unit_id: 'unit',
        guests: 2,
        checkin: '2026-10-15',
        checkout: '2026-10-16',
        duration_nights: 1,
        checkout_time: '12:30',
        revision: 0,
        inspector: null,
        cleaner: null,
        cycle_id: 'cycle',
        inspection_status: 'pending',
        cleaning_status: 'review',
      },
    ],
  };
  const html = renderToStaticMarkup(
    <>
      <ExecutionSummary
        activity={activity}
        data={data}
        person={() => 'Colaborador'}
      />
      <OrderStayContext
        order={data.service_orders[0]}
        data={data}
        manager={false}
        run={vi.fn()}
        showSummary={false}
      />
    </>,
  );
  expect(html.match(/Programação/g)).toHaveLength(1);
  expect(html.match(/Hóspedes/g)).toHaveLength(1);
  expect(html.match(/Preparação completa/g)).toHaveLength(1);
  expect(html).not.toMatch(/Check-in de origem|Ocupação da ordem|Prazo/);
  expect(html).toContain('15/10/2026 a 16/10/2026');
});
it.each(['error', 'success'] as const)(
  'exibe %s sobre o modal e bloqueia os controles ao fundo',
  (kind) => {
    const html = renderToStaticMarkup(
      <Modal
        title="Checklist"
        onClose={vi.fn()}
        feedback={{
          kind,
          title:
            kind === 'error'
              ? 'Não foi possível enviar'
              : 'Enviado com sucesso',
          message: 'Mensagem central',
          actionLabel:
            kind === 'error' ? 'Retomar vistoria' : 'Concluir atividade',
          onAction: vi.fn(),
        }}
      >
        <input aria-label="Quantidade" />
      </Modal>,
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(
      kind === 'error' ? 'Retomar vistoria' : 'Concluir atividade',
    );
  },
);
