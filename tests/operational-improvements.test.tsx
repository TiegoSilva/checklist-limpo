import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyData, type Data, type Item } from '../src/domain';
import { collectPages } from '../src/lib/pagination';
import { readApiResponse, describeError } from '../src/lib/errors';
import { fileSize, PHOTO_LIMIT, VIDEO_LIMIT } from '../src/lib/media';
import { scheduleNotificationRead } from '../src/features/useReadNotifications';
import {
  filterReportRows,
  reportRows,
  recurringFindings,
} from '../src/features/reporting';
import { inventoryDifferences } from '../src/features/inventory';
import ExecutionPhotos from '../src/features/ExecutionPhotos';
const item: Item = {
  id: 'cup',
  inventory_item_id: 'stock',
  title: 'Copos',
  room: 'Cozinha',
  mode: 'count',
  required: true,
  evidence_required: false,
  expected: 4,
};
const data: Data = {
  ...emptyData,
  properties: [{ id: 'p', org_id: 'o', name: 'Praia', address: '' }],
  units: [
    {
      id: 'u',
      property_id: 'p',
      name: '101',
      capacity: 4,
      base_occupancy: 2,
      operational_status: 'ready',
      commercially_available: false,
    },
  ],
  activities: [
    {
      id: 'a',
      unit_id: 'u',
      cycle_id: 'c',
      kind: 'cleaning',
      title: 'Entrada',
      assignee: 'me',
      status: 'completed',
      priority: 'normal',
      due_at: '2026-10-16T16:00:00Z',
      created_at: '2026-10-14T16:00:00Z',
      approved_at: '2026-10-16T18:00:00Z',
      occupancy: 2,
      items: [item],
      responses: {
        cup: {
          confirmed: true,
          found: 3,
          condition: 'divergent',
          note: 'Falta copo',
        },
      },
      revision: 3,
      attempt: 1,
    },
  ],
  service_orders: [
    {
      id: 'in',
      unit_id: 'u',
      order_type: 'checkin',
      activity_id: 'a',
      title: 'Entrada',
      assignee: 'me',
      status: 'approved',
      priority: 'normal',
      blocking: false,
      due_at: '2026-10-16T16:00:00Z',
      created_at: '2026-10-14T16:00:00Z',
      revision: 3,
      description: '',
    },
    {
      id: 'task',
      unit_id: 'u',
      order_type: 'general',
      title: 'Trocar lâmpada',
      assignee: 'me',
      status: 'review',
      priority: 'normal',
      blocking: false,
      due_at: '2026-10-16T16:00:00Z',
      created_at: '2026-10-16T16:00:00Z',
      submitted_at: '2026-10-16T17:00:00Z',
      revision: 2,
      description: '',
    },
  ],
  inventory_items: [
    {
      id: 'stock',
      unit_id: 'u',
      name: 'Copos novos',
      room: 'Cozinha',
      category: 'permanent',
      expected: 6,
    },
  ],
};
describe('consultas e relatórios operacionais', () => {
  it('lê além de mil registros e continua quando o servidor usa páginas menores', async () => {
    const rows = Array.from({ length: 1257 }, (_, id) => ({ id }));
    const fetch = vi.fn(async (offset: number) => ({
      rows: rows.slice(offset, offset + 173),
      total: rows.length,
    }));
    expect(await collectPages(fetch)).toEqual(rows);
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('não duplica checklist vinculado e inclui tarefas nos mesmos filtros', () => {
    expect(reportRows(data).map((r) => r.id)).toEqual(['in', 'task']);
    expect(
      filterReportRows(data, {
        from: '2026-10-16',
        to: '2026-10-16',
        property: 'p',
        person: 'me',
        kind: '',
        criterion: 'due_at',
      }),
    ).toHaveLength(2);
    expect(
      filterReportRows(data, {
        from: '2026-10-16',
        to: '2026-10-16',
        property: 'p',
        person: 'me',
        kind: 'task',
        criterion: 'submitted_at',
      }).map((r) => r.id),
    ).toEqual(['task']);
  });
  it('conta divergências aprovadas sem tratar envio pendente como ocorrência confirmada', () => {
    expect(recurringFindings(data, '2026-10-01', '2026-10-31')).toEqual([
      { unit: 'u', item: 'Copos', events: 1, damaged: 0, divergent: 1 },
    ]);
    expect(
      recurringFindings(
        { ...data, activities: [{ ...data.activities[0], status: 'review' }] },
        '2026-10-01',
        '2026-10-31',
      ),
    ).toEqual([]);
  });
  it('compara inventário por identidade e preserva regras por hóspede', () => {
    const diff = inventoryDifferences(data, 'u', [item]);
    expect(diff[0].current.expected).toBe(6);
    expect(item.expected).toBe(4);
    expect(
      inventoryDifferences(data, 'u', [
        { ...item, title: 'Copos novos', expected: 999, quantity_per_guest: 1 },
      ]),
    ).toEqual([]);
  });
});
describe('leitura de notificações após dois segundos visíveis', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('não marca antes de dois segundos e cancela ao sair', async () => {
    const read = vi.fn(async () => {});
    const dispose = scheduleNotificationRead({
      visible: () => true,
      subscribe: () => () => {},
      read,
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(read).not.toHaveBeenCalled();
    dispose();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).not.toHaveBeenCalled();
  });
  it('reinicia a contagem ao ocultar a tela e marca uma única vez', async () => {
    let visible = true,
      listener = () => {};
    const read = vi.fn(async () => {});
    const dispose = scheduleNotificationRead({
      visible: () => visible,
      subscribe: (fn) => {
        listener = fn;
        return () => {};
      },
      read,
    });
    await vi.advanceTimersByTimeAsync(1500);
    visible = false;
    listener();
    await vi.advanceTimersByTimeAsync(3000);
    expect(read).not.toHaveBeenCalled();
    visible = true;
    listener();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(1);
    listener();
    await vi.advanceTimersByTimeAsync(3000);
    expect(read).toHaveBeenCalledTimes(1);
    dispose();
  });
});
describe('erros descritivos e tamanho das evidências', () => {
  it('transforma HTML ou resposta de API inválida em erro de confirmação identificável', async () => {
    await expect(
      readApiResponse(new Response('<html>Portal</html>', { status: 200 })),
    ).rejects.toThrow(/API|servidor|resposta inválida/);
    expect(
      describeError(
        new Error('The string did not match the expected pattern.'),
      ),
    ).toContain('NETWORK_OR_RESPONSE');
  });
  it('mostra nome, tamanho e estado de envio no preview', () => {
    const html = renderToStaticMarkup(
      <ExecutionPhotos
        photos={[
          {
            id: 'file',
            file: new File([new Uint8Array(1024 * 1024)], 'cozinha.jpg', {
              type: 'image/jpeg',
            }),
          },
        ]}
        evidence={[]}
        attempt={1}
        editable={false}
        uploads={{ file: { percent: 57, phase: 'upload' } }}
        onChange={vi.fn()}
        onError={vi.fn()}
        onView={vi.fn()}
      />,
    );
    expect(html).toContain('cozinha.jpg');
    expect(html).toContain('1 MB');
    expect(html).toContain('Enviando 57%');
    expect(html).toContain('value="57"');
    expect(fileSize(512)).toBe('1 KB');
    expect(PHOTO_LIMIT).toBe(25 * 1024 * 1024);
    expect(VIDEO_LIMIT).toBe(200 * 1024 * 1024);
  });
});
