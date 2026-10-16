import { dayKey, type Data } from '../domain';
export type ReportRow = {
  id: string;
  unit_id: string;
  title: string;
  kind: string;
  assignee: string;
  status: string;
  created_at?: string;
  due_at: string;
  started_at?: string;
  submitted_at?: string;
  approved_at?: string;
};
export function reportRows(data: Data): ReportRow[] {
  const linked = new Set(
    data.service_orders.filter((s) => !s.deleted_at).map((s) => s.activity_id),
  );
  return [
    ...data.service_orders
      .filter((s) => !s.deleted_at && s.status !== 'cancelled')
      .map((s) => {
        const a = data.activities.find((a) => a.id === s.activity_id);
        return {
          ...s,
          kind:
            s.order_type === 'checkin'
              ? 'checkin'
              : s.order_type === 'checkout'
                ? 'checkout'
                : 'task',
          created_at: s.created_at ?? a?.created_at,
          started_at: a?.started_at ?? s.started_at,
          submitted_at: a?.submitted_at ?? s.submitted_at,
          approved_at: a?.approved_at ?? s.approved_at,
        };
      }),
    ...data.activities
      .filter(
        (a) => !a.deleted_at && a.status !== 'cancelled' && !linked.has(a.id),
      )
      .map((a) => ({
        ...a,
        kind: a.kind === 'inspection' ? 'checkout' : 'checkin',
      })),
  ];
}
export function filterReportRows(
  data: Data,
  filters: {
    from: string;
    to: string;
    property: string;
    person: string;
    kind: string;
    criterion: 'due_at' | 'created_at' | 'submitted_at' | 'approved_at';
  },
) {
  return reportRows(data).filter((row) => {
    const date = row[filters.criterion];
    return (
      date &&
      dayKey(new Date(date)) >= filters.from &&
      dayKey(new Date(date)) <= filters.to &&
      (!filters.property ||
        data.units.some(
          (u) => u.id === row.unit_id && u.property_id === filters.property,
        )) &&
      (!filters.person || row.assignee === filters.person) &&
      (!filters.kind || row.kind === filters.kind)
    );
  });
}
export function recurringFindings(
  data: Data,
  from: string,
  to: string,
  property = '',
) {
  const groups = new Map<
    string,
    {
      unit: string;
      item: string;
      events: number;
      damaged: number;
      divergent: number;
    }
  >();
  const add = (
    unit: string,
    item: Data['activities'][number]['items'][number],
    response: Data['activities'][number]['responses'][string],
  ) => {
    if (
      !response?.confirmed ||
      !['divergent', 'damaged', 'broken'].includes(response.condition ?? '')
    )
      return;
    const identity = item.inventory_item_id ?? item.id;
    const key = `${unit}:${identity}`;
    const entry = groups.get(key) ?? {
      unit,
      item: item.title,
      events: 0,
      damaged: 0,
      divergent: 0,
    };
    entry.events++;
    if (response.condition === 'divergent') entry.divergent++;
    else entry.damaged++;
    groups.set(key, entry);
  };
  // Conta cada tentativa aprovada uma vez. Tentativas rejeitadas não confirmam uma ocorrência.
  for (const a of data.activities) {
    if (
      a.deleted_at ||
      !['completed', 'review', 'in_progress', 'correction', 'pending'].includes(
        a.status,
      ) ||
      (property &&
        !data.units.some(
          (u) => u.id === a.unit_id && u.property_id === property,
        ))
    )
      continue;
    const history = data.checklist_review_cycles.filter(
      (r) => r.activity_id === a.id && r.decision === 'approved',
    );
    const snapshots = history.length
      ? history.map((r) => ({
          items: r.snapshot.items,
          responses: r.snapshot.responses,
          date: r.reviewed_at,
        }))
      : a.status === 'completed'
        ? [{ items: a.items, responses: a.responses, date: a.approved_at }]
        : [];
    for (const snapshot of snapshots)
      if (
        snapshot.date &&
        dayKey(new Date(snapshot.date)) >= from &&
        dayKey(new Date(snapshot.date)) <= to
      )
        for (const item of snapshot.items)
          add(a.unit_id, item, snapshot.responses[item.id]);
  }
  return [...groups.values()].sort(
    (a, b) => b.events - a.events || a.item.localeCompare(b.item, 'pt-BR'),
  );
}
