import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WorkOrderEditor, {
  departureDate,
  buildOrderPayload,
  initialOrderDraft,
  orderStepError,
  orderPlan,
  validTimeWindow,
} from '../src/features/WorkOrderEditor';
import { canAdjustCheckout } from '../src/features/OrderStayContext';
import type { Service } from '../src/domain';
import { emptyData } from '../src/domain';
import StayAgenda from '../src/features/StayAgenda';

describe('estadia e ordens de serviço', () => {
  it('valida a faixa completa de início e fim sem aceitar horários invertidos', () => {
    expect(validTimeWindow('11:30', '12:30')).toBe(true);
    expect(validTimeWindow('13:30', '15:00')).toBe(true);
    expect(validTimeWindow('12:30', '11:30')).toBe(false);
    expect(validTimeWindow('12:30', '12:30')).toBe(false);
    expect(validTimeWindow('24:00', '25:00')).toBe(false);
  });
  it('mostra ajuste de checkout iniciado apenas no dia de execução, antes da revisão', () => {
    const order = { order_type: 'checkout', status: 'in_progress' } as Service;
    expect(canAdjustCheckout(order, '2026-10-15', '2026-10-15')).toBe(true);
    expect(canAdjustCheckout(order, '2026-10-14', '2026-10-15')).toBe(false);
    expect(
      canAdjustCheckout(
        { ...order, status: 'review' },
        '2026-10-15',
        '2026-10-15',
      ),
    ).toBe(false);
    expect(
      canAdjustCheckout(
        { ...order, order_type: 'checkin' },
        '2026-10-15',
        '2026-10-15',
      ),
    ).toBe(false);
  });
  it.each([
    ['2026-10-30', 3, '2026-11-02'],
    ['2028-02-28', 2, '2028-03-01'],
    ['2026-12-31', 1, '2027-01-01'],
  ])(
    'calcula saída por diárias atravessando limites do calendário (%s)',
    (arrival, nights, expected) => {
      expect(departureDate(arrival, nights)).toBe(expected);
    },
  );
  it('mostra somente os detalhes da estadia no segundo passo', () => {
    const html = renderToStaticMarkup(
      <WorkOrderEditor
        data={emptyData}
        run={vi.fn()}
        onClose={vi.fn()}
        initialType="checkin"
      />,
    );
    expect(html).toContain('Passo 2 de 4');
    expect(html).toContain('Data de entrada');
    expect(html).toContain('Diárias da estadia');
    expect(html).toContain('Quantidade de hóspedes');
    expect(html).not.toContain('Responsável pelo checkout');
    expect(html).not.toContain('Data e horário do prazo');
  });
  it('começa com uma escolha de tipo, sem exibir campos redundantes', () => {
    const html = renderToStaticMarkup(
      <WorkOrderEditor data={emptyData} run={vi.fn()} onClose={vi.fn()} />,
    );
    expect(html).toContain('O que vamos organizar?');
    expect(html.match(/name="order-intent"/g)).toHaveLength(2);
    expect(html).not.toContain('value="checklist"');
    expect(initialOrderDraft(emptyData).intent).toBe('checkin');
    expect(html).not.toContain('datetime-local');
    expect(html).not.toContain('Nome do hóspede');
  });
  it('mantém o payload completo independentemente dos campos desmontados entre passos', () => {
    const data = {
      ...emptyData,
      units: [
        {
          id: 'u',
          property_id: 'p',
          name: 'Teste',
          capacity: 4,
          base_occupancy: 2,
          operational_status: 'ready',
          commercially_available: false,
        },
      ],
      profiles: [
        { id: 'person', name: 'Equipe', active: true, font_scale: 100 },
      ],
      memberships: [
        {
          org_id: 'org',
          user_id: 'person',
          roles: ['cleaner', 'inspector'] as ('cleaner' | 'inspector')[],
        },
      ],
    };
    const d = {
      ...initialOrderDraft(data, 'checkin'),
      title: 'Ana',
      arrival: '2026-12-31',
      nights: 3,
      guests: 2,
      description: 'Chegada ao fim da tarde',
    };
    expect(orderStepError(data, d, 1)).toBe('');
    expect(orderStepError(data, d, 2)).toBe('');
    expect(buildOrderPayload(data, d, 'event')).toMatchObject({
      guest_name: 'Ana',
      checkin: '2026-12-31',
      duration_nights: 3,
      guests: 2,
      assignee: 'person',
      checkout_assignee: 'person',
      execution_mode: 'task',
      checkin_start_time: '13:30',
      checkin_time: '15:00',
      checkout_start_time: '12:00',
      checkout_time: '12:30',
      description: 'Chegada ao fim da tarde',
    });
    const task = {
      ...d,
      intent: 'task' as const,
      title: 'Trocar lâmpada',
      due: '2026-10-15T12:00',
    };
    const payload = buildOrderPayload(data, task, 'task');
    expect(payload).toMatchObject({
      title: 'Trocar lâmpada',
      order_type: 'general',
      execution_mode: 'task',
    });
    expect(payload).not.toHaveProperty('duration_nights');
    expect(orderStepError(data, { ...d, guests: 5 }, 1)).toContain('até 4');
    expect(orderStepError(data, { ...task, due: '' }, 2)).toContain('prazo');
    expect(
      orderPlan(
        {
          ...data,
          checklist_template_versions: [
            {
              id: 'removed',
              unit_id: 'u',
              kind: 'cleaning',
              version: 1,
              items: [],
              archived_at: '2026-10-15',
            },
          ],
        },
        d,
      ).model,
    ).toBeUndefined();
  });
  it('permite editar a saída com check-in concluído enquanto checkout está pendente', () => {
    const data = {
      ...emptyData,
      team_agenda: [
        {
          id: 'stay',
          unit_id: 'unit',
          guests: 2,
          checkin: '2099-01-01',
          checkout: '2099-01-04',
          checkout_time: '12:00',
          revision: 0,
          inspector: null,
          cleaner: null,
          cycle_id: 'cycle',
          inspection_status: 'pending',
          cleaning_status: 'completed',
          checkin_order_id: 'in',
          checkout_order_id: 'out',
          duration_nights: 3,
          checkin_status: 'approved',
        },
      ],
    };
    const html = renderToStaticMarkup(
      <StayAgenda data={data} manager={true} property="" run={vi.fn()} />,
    );
    expect(html).toContain('Editar saída');
    expect(html).toContain('Pendente');
    expect(html).toContain('3 diária(s)');
  });
});
