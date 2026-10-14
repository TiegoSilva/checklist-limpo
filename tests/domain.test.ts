import { describe, expect, it } from 'vitest';
import {
  csv,
  dayKey,
  progress,
  selectItems,
  sortActivities,
  type Activity,
  type Item,
} from '../src/domain';
describe('regras da interface', () => {
  it('filtra tarefas por ocupação sem duplicar a base', () => {
    const items = [
      { id: 'base' },
      { id: 'extra', min_guests: 3 },
      { id: 'small', max_guests: 2 },
    ] as Item[];
    expect(selectItems(items, 4).map((i) => i.id)).toEqual(['base', 'extra']);
  });
  it('não considera quantidades previamente preenchidas como conferidas', () => {
    const a = {
      items: [{ id: 'x', required: true }],
      responses: { x: { found: 2 } },
    } as unknown as Activity;
    expect(progress(a)).toBe(0);
  });
  it('prioriza atrasadas e urgentes antes das concluídas', () => {
    const date = '2026-10-14T16:00:00Z';
    const activities = [
      { id: 'done', status: 'completed', due_at: '2026-10-13T12:00:00Z' },
      { id: 'pending', status: 'pending', due_at: '2026-10-14T18:00:00Z' },
      { id: 'late', status: 'pending', due_at: '2026-10-14T12:00:00Z' },
      {
        id: 'urgent',
        status: 'pending',
        priority: 'urgent',
        due_at: '2026-10-14T19:00:00Z',
      },
    ] as Activity[];
    expect(sortActivities(activities, new Date(date)).map((a) => a.id)).toEqual(
      ['late', 'urgent', 'pending', 'done'],
    );
  });
  it('exporta CSV escapando aspas e fórmulas', () => {
    expect(csv([['=cmd', 'a"b', 'texto']])).toBe(
      '\uFEFF"\'=cmd";"a""b";"texto"',
    );
  });
  it('apresenta datas na zona de São Paulo', () => {
    expect(dayKey(new Date('2026-10-15T01:00:00Z'))).toBe('2026-10-14');
  });
});
