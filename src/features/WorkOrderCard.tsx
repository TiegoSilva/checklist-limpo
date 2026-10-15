import {
  ClipboardList,
  LogIn,
  LogOut,
  Wrench,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '../components';
import type { Data, Service } from '../domain';
import { serviceWindow } from './OrderStayContext';
import { templateName } from './checklists';
export default function WorkOrderCard({
  order: s,
  data,
  onOpen,
}: {
  order: Service;
  data: Data;
  onOpen: (order: Service) => void;
}) {
  const model = data.checklist_template_versions.find(
    (t) => t.id === s.template_id,
  );
  const origin = s.checkin_order_id ?? s.parent_order_id;
  const Icon =
    s.order_type === 'checkin'
      ? LogIn
      : s.order_type === 'checkout'
        ? LogOut
        : s.execution_mode === 'checklist'
          ? ClipboardList
          : Wrench;
  return (
    <button className="service-row" onClick={() => onOpen(s)}>
      <span className="section-icon">
        <Icon size={20} />
      </span>
      <div className="order-copy">
        <strong>{s.title}</strong>
        <small>
          {data.units.find((u) => u.id === s.unit_id)?.name ?? 'Unidade'} ·{' '}
          {data.profiles.find((p) => p.id === s.assignee)?.name ??
            'Colaborador'}
        </small>
        <small>{serviceWindow(s)}</small>
        <small>
          {model ? templateName(model) : 'Tarefa simples'}
          {origin && s.order_type !== 'checkin'
            ? ` · Check-in #${origin.slice(0, 8)}`
            : ''}
        </small>
        {s.blocking && (
          <small className="error-text">Impede a liberação da unidade</small>
        )}
      </div>
      <Badge status={s.status} />
      <ChevronRight size={17} />
    </button>
  );
}
