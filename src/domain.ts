export type Role = 'admin' | 'manager' | 'inspector' | 'cleaner';
export type Item = {
  id: string;
  room: string;
  title: string;
  mode: 'task' | 'technical' | 'count';
  required: boolean;
  evidence_required: boolean;
  expected?: number;
  quantity_per_guest?: number;
  min_guests?: number;
  max_guests?: number;
  allow_na?: boolean;
  reference_path?: string;
  instructions?: string;
};
export type Response = {
  confirmed: boolean;
  answer?: string;
  found?: number;
  condition?: string;
  note?: string;
  laundry?: number;
  damaged?: number;
  missing?: number;
  replenished?: number;
};
export type Activity = {
  id: string;
  unit_id: string;
  cycle_id: string;
  kind: 'inspection' | 'cleaning' | 'complement';
  title: string;
  assignee: string;
  status: string;
  priority: string;
  due_at: string;
  occupancy: number;
  items: Item[];
  responses: Record<string, Response>;
  revision: number;
  attempt: number;
  created_at: string;
  started_at?: string;
  submitted_at?: string;
  approved_at?: string;
  approved_by?: string;
};
export type Property = {
  id: string;
  org_id: string;
  name: string;
  address: string;
};
export type Unit = {
  id: string;
  property_id: string;
  name: string;
  capacity: number;
  base_occupancy: number;
  operational_status: string;
  prepared_for?: number;
  commercially_available: boolean;
};
export type Profile = {
  id: string;
  name: string;
  active: boolean;
  font_scale: number;
};
export type Service = {
  id: string;
  unit_id: string;
  title: string;
  description: string;
  assignee: string;
  status: string;
  priority: string;
  blocking: boolean;
  due_at: string;
  revision: number;
  completion_note?: string;
};
export type Evidence = {
  id: string;
  activity_id: string;
  item_id: string;
  path: string;
  received_at: string;
  uploader: string;
  sha256: string;
};
export type Review = {
  id: string;
  activity_id: string;
  attempt: number;
  decision?: string;
  reason?: string;
  rejected_items: string[];
  submitted_at: string;
  snapshot: Activity;
  reviewer?: string;
  reviewed_at?: string;
};
export type Finding = {
  id: string;
  activity_id: string;
  title: string;
  description: string;
  blocking: boolean;
  resolved_at?: string;
  created_at: string;
};
export type Notice = {
  id: string;
  title: string;
  message: string;
  read_at?: string;
  activity_id?: string;
  created_at: string;
};
export type Audit = {
  id: string;
  property_id: string;
  actor: string | null;
  actor_roles: string[];
  event: string;
  resource_id: string;
  created_at: string;
  reason?: string;
  before_data: unknown;
  after_data: unknown;
  correlation_id: string;
};
export type AgendaEntry = {
  id: string;
  unit_id: string;
  guests: number;
  checkin: string;
  checkout: string;
  checkout_time: string;
  revision: number;
  inspector: string | null;
  cleaner: string | null;
  cycle_id: string | null;
  inspection_status: string | null;
  cleaning_status: string | null;
};
export type Data = {
  team_agenda: AgendaEntry[];
  agenda_ready?: boolean;
  service_evidence: {
    id: string;
    service_id: string;
    path: string;
    received_at: string;
  }[];
  properties: Property[];
  units: Unit[];
  activities: Activity[];
  profiles: Profile[];
  memberships: { org_id: string; user_id: string; roles: Role[] }[];
  organizations: { id: string; name: string }[];
  notifications: Notice[];
  service_orders: Service[];
  evidence_files: Evidence[];
  checklist_review_cycles: Review[];
  findings: Finding[];
  audit_events: Audit[];
  inventory_items: {
    id: string;
    unit_id: string;
    name: string;
    room: string;
    category: string;
    expected: number;
  }[];
  checklist_template_versions: {
    id: string;
    unit_id: string;
    kind: string;
    version: number;
    items: Item[];
    publication_source?: 'user' | 'migration';
  }[];
  environments: { id: string; unit_id: string; name: string }[];
  stays: {
    id: string;
    unit_id: string;
    guest_name: string;
    guests: number;
    checkin: string;
    checkout: string;
  }[];
  preparation_cycles: {
    reservation_id?: string;
    id: string;
    stay_id: string;
    occupancy_source: string;
  }[];
};
export const emptyData: Data = {
  team_agenda: [],
  service_evidence: [],
  properties: [],
  units: [],
  activities: [],
  profiles: [],
  memberships: [],
  organizations: [],
  notifications: [],
  service_orders: [],
  evidence_files: [],
  checklist_review_cycles: [],
  findings: [],
  audit_events: [],
  inventory_items: [],
  checklist_template_versions: [],
  environments: [],
  stays: [],
  preparation_cycles: [],
};
export const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  review: 'Aguardando aprovação',
  correction: 'Correção solicitada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  unavailable: 'Indisponível',
  preparing: 'Em preparação',
  ready: 'Pronta para receber',
  adjustment: 'Aguarda adequação',
  assigned: 'Atribuída',
  approved: 'Aprovada',
  rejected: 'Correção solicitada',
};
export const dateTime = (s: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(s));
export const dayKey = (d: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
export function progress(a: Activity) {
  const required = a.items.filter((i) => i.required);
  return required.length
    ? Math.round(
        (required.filter((i) => a.responses[i.id]?.confirmed).length /
          required.length) *
          100,
      )
    : 0;
}
export function sortActivities(a: Activity[], now = new Date()) {
  const rank = (x: Activity) =>
    x.status === 'completed' || x.status === 'cancelled'
      ? 5
      : new Date(x.due_at) < now
        ? 0
        : x.priority === 'urgent'
          ? 1
          : x.status === 'correction'
            ? 2
            : x.status === 'in_progress'
              ? 3
              : 4;
  return [...a].sort(
    (x, y) => rank(x) - rank(y) || Date.parse(x.due_at) - Date.parse(y.due_at),
  );
}
export function selectItems(items: Item[], occupancy: number) {
  return items
    .filter(
      (i) =>
        (i.min_guests ?? 1) <= occupancy && (i.max_guests ?? 999) >= occupancy,
    )
    .map((i) =>
      i.quantity_per_guest === undefined
        ? i
        : { ...i, expected: i.quantity_per_guest * occupancy },
    );
}
export function csv(rows: unknown[][]) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? '');
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(';'),
      )
      .join('\r\n')
  );
}
export function download(
  name: string,
  text: string,
  type = 'text/csv;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
