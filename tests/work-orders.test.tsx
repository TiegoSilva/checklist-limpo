import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WorkOrderEditor, {
  departureDate,
} from '../src/features/WorkOrderEditor';
import { emptyData } from '../src/domain';
import StayAgenda from '../src/features/StayAgenda';

describe('estadia e ordens de serviço', () => {
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
  it('pede duração, hóspedes e formato de execução das duas ordens', () => {
    const html = renderToStaticMarkup(
      <WorkOrderEditor
        data={emptyData}
        run={vi.fn()}
        onClose={vi.fn()}
        initialType="checkin"
      />,
    );
    expect(html).toContain('Duração da estadia (diárias)');
    expect(html).toContain('Quantidade de hóspedes');
    expect(html).toContain('Checkout automático');
    expect(html).toContain('Tarefa simples de checkout');
    expect(html).toContain('Criar check-in e checkout');
    expect(html).not.toContain('name="checkout"');
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
    expect(html).toContain('Checkout programado');
    expect(html).toContain('3 diária(s)');
  });
});
