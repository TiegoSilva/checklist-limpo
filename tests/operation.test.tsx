import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  emptyData,
  type Activity,
  type Data,
  type Service,
} from '../src/domain';
import { pendingApprovals, stayOrdersToday } from '../src/features/operation';
import TemplateEditor from '../src/features/TemplateEditor';

const order = (id: string, patch: Partial<Service> = {}): Service => ({
  id,
  unit_id: 'unit',
  title: id,
  description: '',
  assignee: 'me',
  status: 'assigned',
  priority: 'normal',
  blocking: false,
  revision: 0,
  order_type: 'checkin',
  due_at: '2026-10-15T18:00:00Z',
  scheduled_start_at: '2026-10-15T16:30:00Z',
  ...patch,
});
const activity = (id: string, patch: Partial<Activity> = {}): Activity => ({
  id,
  unit_id: 'unit',
  cycle_id: 'cycle',
  kind: 'cleaning',
  title: id,
  assignee: 'me',
  status: 'review',
  priority: 'normal',
  due_at: '2026-10-14T18:00:00Z',
  occupancy: 2,
  items: [],
  responses: {},
  revision: 1,
  attempt: 1,
  created_at: '2026-10-14T12:00:00Z',
  ...patch,
});
const unit = {
  id: 'unit',
  property_id: 'property',
  name: 'Apartamento Jardim',
  capacity: 4,
  base_occupancy: 2,
  operational_status: 'preparing',
  commercially_available: false,
};

describe('prioridade do dashboard e acompanhamento de aprovações', () => {
  it('inclui envios próprios e da equipe, mesmo atrasados, sem duplicar ordens vinculadas ao checklist', () => {
    const result = pendingApprovals(
      [
        activity('own'),
        activity('team', { assignee: 'other' }),
        activity('done', { status: 'completed' }),
        activity('deleted', { deleted_at: '2026-10-15' }),
      ],
      [
        order('own-task', { status: 'review' }),
        order('linked', { status: 'review', activity_id: 'own' }),
        order('deleted-task', { status: 'review', deleted_at: '2026-10-15' }),
        order('pending'),
      ],
    );
    expect(result.activities.map((a) => a.id)).toEqual(['own', 'team']);
    expect(result.tasks.map((s) => s.id)).toEqual(['own-task']);
  });
  it('prioriza todas as entradas e saídas do dia por início, incluindo revisão e conclusão, sem canceladas ou removidas', () => {
    const data: Data = {
      ...emptyData,
      units: [unit],
      service_orders: [
        order('review', { status: 'review', activity_id: 'own' }),
        order('out', {
          order_type: 'checkout',
          scheduled_start_at: '2026-10-15T14:30:00Z',
          due_at: '2026-10-15T15:30:00Z',
          status: 'approved',
        }),
        order('tomorrow', { scheduled_start_at: '2026-10-16T16:30:00Z' }),
        order('overdue', { scheduled_start_at: '2026-10-14T16:30:00Z' }),
        order('task', { order_type: 'general' }),
        order('cancelled', { status: 'cancelled' }),
        order('deleted', { deleted_at: '2026-10-15' }),
      ],
    };
    expect(
      stayOrdersToday(data, '', '', '2026-10-15').map((s) => s.id),
    ).toEqual(['out', 'review']);
    expect(stayOrdersToday(data, 'other', '', '2026-10-15')).toEqual([]);
    expect(
      stayOrdersToday(data, 'property', 'JARDIM', '2026-10-15'),
    ).toHaveLength(2);
    expect(stayOrdersToday(data, '', 'missing', '2026-10-15')).toEqual([]);
  });
  it('considera o dia de São Paulo e usa o prazo quando não há início definido', () => {
    const data: Data = {
      ...emptyData,
      service_orders: [
        order('late', { scheduled_start_at: '2026-10-16T02:59:00Z' }),
        order('next', { scheduled_start_at: '2026-10-16T03:00:00Z' }),
        order('fallback', {
          scheduled_start_at: undefined,
          due_at: '2026-10-15T15:00:00Z',
        }),
      ],
    };
    expect(
      stayOrdersToday(data, '', '', '2026-10-15').map((s) => s.id),
    ).toEqual(['fallback', 'late']);
  });
});

describe('modelo com uma única lista', () => {
  it('preserva itens, tarefas e conferências existentes em uma seção e um botão de adição', () => {
    const data: Data = {
      ...emptyData,
      units: [unit],
      checklist_template_versions: [
        {
          id: 'mixed',
          unit_id: 'unit',
          kind: 'cleaning',
          version: 1,
          name: 'Modelo misto',
          items: [
            {
              id: 'cup',
              room: 'Geral',
              title: 'Copos',
              mode: 'count',
              expected: 4,
              required: true,
              evidence_required: false,
            },
            {
              id: 'clean',
              room: 'Geral',
              title: 'Limpar banheiro',
              mode: 'task',
              required: true,
              evidence_required: false,
            },
            {
              id: 'lock',
              room: 'Geral',
              title: 'Verificar fechadura',
              mode: 'technical',
              required: true,
              evidence_required: false,
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <TemplateEditor
        data={data}
        templateId="mixed"
        onClose={vi.fn()}
        run={vi.fn()}
      />,
    );
    expect(html.match(/class="editor-section"/g)).toHaveLength(1);
    expect(html.match(/Adicionar item/g)).toHaveLength(1);
    expect(html).not.toContain('Adicionar tarefa');
    for (const title of ['Copos', 'Limpar banheiro', 'Verificar fechadura'])
      expect(html).toContain(`value="${title}"`);
    expect(html.match(/Tipo de conferência/g)).toHaveLength(3);
  });
});
