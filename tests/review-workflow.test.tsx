import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '../src/components';
import {
  emptyData,
  type Activity,
  type Data,
  type Item,
  type Service,
} from '../src/domain';
import ActivityDetail from '../src/features/ActivityDetail';
import { ServiceDetail } from '../src/management';
import { executionIssue, updateItemResponse } from '../src/features/execution';
const item: Item = {
  id: 'towel',
  title: 'Toalhas',
  room: 'Geral',
  mode: 'count',
  required: true,
  evidence_required: true,
  expected: 2,
};
const activity: Activity = {
  id: 'a',
  unit_id: 'u',
  cycle_id: 'c',
  kind: 'cleaning',
  title: 'Check-in',
  assignee: 'me',
  status: 'review',
  priority: 'normal',
  due_at: '2026-10-15T18:00:00Z',
  occupancy: 3,
  items: [item],
  responses: { towel: { confirmed: true, found: 2, condition: 'ok' } },
  revision: 1,
  attempt: 1,
  created_at: '2026-10-15T12:00:00Z',
};
const order: Service = {
  id: 's',
  unit_id: 'u',
  title: 'Check-in',
  description: '',
  assignee: 'me',
  status: 'review',
  priority: 'normal',
  blocking: false,
  due_at: activity.due_at,
  revision: 1,
};
const props = {
  activity,
  data: emptyData,
  user: 'me',
  manager: true,
  busy: false,
  run: vi.fn(),
  onClose: vi.fn(),
  unitName: () => 'Unidade',
  person: () => 'Gestor',
};
describe('revisão e preenchimento prático', () => {
  it('oferece conclusão da própria revisão ao gestor no rodapé, sem permitir revisão pelo colaborador', () => {
    const html = renderToStaticMarkup(<ActivityDetail {...props} />);
    expect(html).toContain('Concluir revisão');
    expect(html.indexOf('execution-footer')).toBeLessThan(
      html.indexOf('Concluir revisão'),
    );
    expect(
      renderToStaticMarkup(<ActivityDetail {...props} manager={false} />),
    ).not.toContain('Concluir revisão');
  });
  it('oferece ações diretas para tarefa em revisão sem seletor vazio de ação', () => {
    const html = renderToStaticMarkup(
      <ServiceDetail
        service={order}
        data={emptyData}
        user="me"
        manager
        run={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain('Concluir revisão');
    expect(html).toContain('Solicitar correção');
    expect(html).not.toContain('Próxima ação');
    expect(html).not.toContain('Descrição do serviço realizado');
  });
  it('mantém hóspedes e diárias no contexto fixo e recolhe detalhes complementares', () => {
    const data: Data = {
      ...emptyData,
      service_orders: [
        {
          ...order,
          activity_id: 'a',
          reservation_id: 'r',
          order_type: 'checkin',
        },
      ],
      preparation_cycles: [
        {
          id: 'c',
          stay_id: 'r',
          occupancy_source: 'reservation',
        },
      ],
      stays: [
        {
          id: 'r',
          unit_id: 'u',
          guest_name: 'Exemplo',
          guests: 3,
          checkin: '2026-10-15',
          checkout: '2026-10-18',
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ActivityDetail {...props} data={data} />,
    );
    expect(html).toMatch(
      /stay-facts[\s\S]*?<strong>3<\/strong> hóspedes[\s\S]*?<strong>3<\/strong> diária/,
    );
    expect(html).not.toContain('execution-more" open');
  });
  it.each([
    ['assigned', 'Pendente'],
    ['pending', 'Pendente'],
    ['in_progress', 'Pendente'],
    ['correction', 'Pendente'],
    ['rejected', 'Pendente'],
    ['review', 'Aguardando aprovação'],
    ['approved', 'Concluída'],
    ['completed', 'Concluída'],
  ])('exibe %s como %s', (status, label) => {
    expect(renderToStaticMarkup(<Badge status={status} />)).toContain(label);
  });
  it('considera quantidade ou condição alterada como conferida e permite desmarcar depois', () => {
    const counted = updateItemResponse(item, undefined, { found: 1 });
    expect(counted).toMatchObject({
      confirmed: true,
      found: 1,
      condition: 'divergent',
    });
    expect(
      updateItemResponse(item, counted, { confirmed: false }).confirmed,
    ).toBe(false);
    expect(
      updateItemResponse(item, undefined, { condition: 'damaged' }).confirmed,
    ).toBe(true);
  });
  it('indica o primeiro item pendente antes do envio e exige nota e foto quando necessário', () => {
    expect(executionIssue([item], {}, true)?.itemId).toBe('towel');
    expect(
      executionIssue([item], { towel: { confirmed: true, found: 1 } }, true)
        ?.message,
    ).toMatch(/descreva/i);
    expect(
      executionIssue([item], { towel: { confirmed: true, found: 2 } }, false)
        ?.message,
    ).toMatch(/foto/);
    expect(
      executionIssue([item], { towel: { confirmed: true, found: 2 } }, true),
    ).toBeNull();
    expect(
      executionIssue([item], { towel: { confirmed: true, found: 1 } }, false, [
        'towel',
      ])?.message,
    ).toMatch(/foto/);
    expect(
      executionIssue([item], { towel: { confirmed: true, found: 1 } }, true, [
        'towel',
      ]),
    ).toBeNull();
  });
});
