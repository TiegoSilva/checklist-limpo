import { Badge } from '../components';
import { dateTime, type Activity, type Data } from '../domain';
import { serviceWindow } from './OrderStayContext';
import { templateName } from './checklists';
const date = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
export default function ExecutionSummary({
  activity: a,
  data,
  person,
  compact = false,
}: {
  activity: Activity;
  data: Data;
  person: (id: string) => string;
  compact?: boolean;
}) {
  const order = data.service_orders.find((s) => s.activity_id === a.id);
  const model = data.checklist_template_versions.find(
    (t) => t.id === order?.template_id,
  );
  const cycle = data.preparation_cycles.find((c) => c.id === a.cycle_id);
  const stay = data.stays.find((s) => s.id === cycle?.stay_id);
  const booking = data.team_agenda.find((r) => r.id === order?.reservation_id);
  const arrival = booking?.checkin ?? stay?.checkin;
  const departure = booking?.checkout ?? stay?.checkout;
  const origin = order?.checkin_order_id ?? order?.parent_order_id;
  return (
    <section className="execution-summary" aria-label="Resumo da execução">
      <div className="execution-summary-heading">
        <Badge status={a.status} />
        <span>{person(a.assignee)}</span>
      </div>
      {compact && (
        <p className="execution-schedule">
          {order ? serviceWindow(order) : dateTime(a.due_at)}
        </p>
      )}
      <details className="execution-more" open={compact ? undefined : true}>
        <summary>Detalhes da estadia e do modelo</summary>
        <dl>
          {!compact && (
            <div>
              <dt>Programação</dt>
              <dd>{order ? serviceWindow(order) : dateTime(a.due_at)}</dd>
            </div>
          )}
          {!compact && (
            <div>
              <dt>Hóspedes</dt>
              <dd>
                {booking?.guests ?? stay?.guests ?? a.occupancy}
                {booking?.duration_nights
                  ? ` · ${booking.duration_nights} diária(s)`
                  : ''}
              </dd>
            </div>
          )}
          {arrival && departure && (
            <div>
              <dt>Estadia</dt>
              <dd>
                {date(arrival)} a {date(departure)}
              </dd>
            </div>
          )}
          {stay?.guest_name && (
            <div>
              <dt>Hóspede</dt>
              <dd>{stay.guest_name}</dd>
            </div>
          )}
          {model && (
            <div>
              <dt>Modelo</dt>
              <dd>
                {templateName(model)} · v{model.version}
              </dd>
            </div>
          )}
          {origin && order?.order_type !== 'checkin' && (
            <div>
              <dt>Check-in de origem</dt>
              <dd>#{origin.slice(0, 8)}</dd>
            </div>
          )}
        </dl>
        <details>
          <summary>Detalhes da execução</summary>
          <p className="muted">
            Tentativa {a.attempt} · Revisão {a.revision}
          </p>
        </details>
      </details>
    </section>
  );
}
