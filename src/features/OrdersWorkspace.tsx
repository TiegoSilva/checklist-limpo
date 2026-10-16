import { useState, useEffect, type ReactNode } from 'react';
import { Empty } from '../components';
import {
  dayKey,
  orderStatus,
  type Activity,
  type Data,
  type Service,
} from '../domain';
import type { Run } from '../lib/client';
import StayAgenda from './StayAgenda';
import { DeletedOrders } from './OrderManagement';
import { matchesSearch } from '../lib/search';
export default function OrdersWorkspace({
  data,
  property,
  search,
  manager,
  user,
  mine,
  run,
  render,
  onHistory,
}: {
  data: Data;
  property: string;
  search: string;
  manager: boolean;
  user: string;
  mine: boolean;
  run: Run;
  render: (activities: Activity[], orders: Service[]) => ReactNode;
  onHistory?: (all: boolean) => void;
}) {
  const [view, setView] = useState<'orders' | 'stays'>('orders'),
    [period, setPeriod] = useState('Hoje'),
    [kind, setKind] = useState(''),
    [status, setStatus] = useState(''),
    [person, setPerson] = useState(''),
    [calendar, setCalendar] = useState(false),
    [date, setDate] = useState(dayKey(new Date()));
  useEffect(
    () =>
      onHistory?.(
        view === 'stays' || ['Todas', 'Concluídas', 'Data'].includes(period),
      ),
    [view, period, onHistory],
  );
  const today = dayKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const match = (
    record: Activity | Service,
    type: string,
    ignorePeriod = false,
  ) => {
    const unit = data.units.find((u) => u.id === record.unit_id),
      parent = data.properties.find((p) => p.id === unit?.property_id),
      responsible = data.profiles.find((p) => p.id === record.assignee),
      day = dayKey(new Date(record.due_at)),
      done = ['completed', 'approved', 'cancelled'].includes(record.status);
    return (
      !record.deleted_at &&
      record.status !== 'cancelled' &&
      (!property || unit?.property_id === property) &&
      (!mine || record.assignee === user) &&
      (!person || record.assignee === person) &&
      (!kind || type === kind) &&
      (!status || orderStatus(record.status) === status) &&
      matchesSearch(
        `${record.title} ${unit?.name} ${parent?.name} ${responsible?.name}`,
        search,
      ) &&
      (ignorePeriod ||
        period === 'Todas' ||
        (period === 'Concluídas' && done) ||
        (period === 'Atrasadas' &&
          !done &&
          new Date(record.due_at) < new Date()) ||
        (period === 'Hoje' && (day === today || (!done && day < today))) ||
        (period === 'Amanhã' && day === dayKey(tomorrow)) ||
        (period === 'Semana' && day >= today && day <= dayKey(week)) ||
        (period === 'Data' && day === date))
    );
  };
  const orders = data.service_orders
    .filter((s) =>
      match(
        s,
        s.order_type === 'checkin'
          ? 'checkin'
          : s.order_type === 'checkout'
            ? 'checkout'
            : 'task',
      ),
    )
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  const activities = data.activities.filter(
    (a) =>
      !data.service_orders.some((s) => s.activity_id === a.id) &&
      match(a, a.kind === 'inspection' ? 'checkout' : 'checkin'),
  );
  return (
    <section className="panel orders-workspace">
      <div className="workspace-tabs">
        <button
          aria-pressed={view === 'orders'}
          onClick={() => setView('orders')}
        >
          Ordens {mine ? 'atribuídas a você' : ''}
        </button>
        <button
          aria-pressed={view === 'stays'}
          onClick={() => setView('stays')}
        >
          Estadias da equipe
        </button>
      </div>
      {view === 'stays' ? (
        <StayAgenda
          data={data}
          manager={manager}
          property={property}
          search={search}
          run={run}
        />
      ) : (
        <>
          <div className="workspace-filters">
            <label className="field">
              Período
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                {[
                  'Hoje',
                  'Amanhã',
                  'Semana',
                  'Atrasadas',
                  'Concluídas',
                  'Todas',
                  'Data',
                ].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            {period === 'Data' && (
              <label className="field">
                Data
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            )}
            <label className="field">
              Tipo
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">Todos</option>
                <option value="checkin">Check-in</option>
                <option value="checkout">Checkout</option>
                <option value="task">Tarefa</option>
              </select>
            </label>
            <label className="field">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="assigned">Pendente</option>
                <option value="review">Aguardando aprovação</option>
                <option value="approved">Concluída</option>
              </select>
            </label>
            {!mine && (
              <label className="field">
                Responsável
                <select
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                >
                  <option value="">Todos</option>
                  {data.profiles.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="section-heading">
            <p role="status">
              {orders.length + activities.length} ordens nos filtros
              selecionados
            </p>
            <button
              className="button secondary"
              onClick={() => setCalendar(!calendar)}
            >
              {calendar ? 'Ocultar calendário' : 'Ver calendário'}
            </button>
          </div>
          {calendar && (
            <div className="week-strip">
              {Array.from({ length: 7 }, (_, i) => {
                const day = new Date();
                day.setDate(day.getDate() + i);
                const key = dayKey(day);
                const count =
                  data.service_orders.filter(
                    (s) =>
                      match(
                        s,
                        s.order_type === 'checkin'
                          ? 'checkin'
                          : s.order_type === 'checkout'
                            ? 'checkout'
                            : 'task',
                        true,
                      ) && dayKey(new Date(s.due_at)) === key,
                  ).length +
                  data.activities.filter(
                    (a) =>
                      !data.service_orders.some(
                        (s) => s.activity_id === a.id,
                      ) &&
                      match(
                        a,
                        a.kind === 'inspection' ? 'checkout' : 'checkin',
                        true,
                      ) &&
                      dayKey(new Date(a.due_at)) === key,
                  ).length;
                return (
                  <button
                    key={key}
                    className="calendar-day"
                    aria-label={`Ver ordens de ${day.toLocaleDateString('pt-BR')}`}
                    onClick={() => {
                      setDate(key);
                      setPeriod('Data');
                    }}
                  >
                    <small>
                      {day.toLocaleDateString('pt-BR', { weekday: 'short' })}
                    </small>
                    <strong>{day.getDate()}</strong>
                    <span>{count} ordens</span>
                  </button>
                );
              })}
            </div>
          )}
          {orders.length + activities.length ? (
            render(activities, orders)
          ) : (
            <Empty
              title="Nenhuma ordem nos filtros selecionados"
              description="Altere o período, a busca ou os filtros para encontrar outras ordens."
            />
          )}
          {manager && !mine && (
            <details
              className="room-section"
              onToggle={(e) => {
                if (e.currentTarget.open) onHistory?.(true);
              }}
            >
              <summary>Histórico e ordens removidas</summary>
              {render(
                [],
                data.service_orders.filter(
                  (s) =>
                    s.status === 'cancelled' &&
                    !s.deleted_at &&
                    (!property ||
                      data.units.some(
                        (u) => u.id === s.unit_id && u.property_id === property,
                      )),
                ),
              )}
              <DeletedOrders data={data} run={run} property={property} />
            </details>
          )}
        </>
      )}
    </section>
  );
}
