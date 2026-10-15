import { CalendarDays } from 'lucide-react';
import type { Data, Service } from '../domain';
import WorkOrderCard from './WorkOrderCard';
import { stayOrdersToday } from './operation';
export default function TodayStayOrders({
  data,
  property,
  search,
  onOpen,
}: {
  data: Data;
  property: string;
  search: string;
  onOpen: (order: Service) => void;
}) {
  const orders = stayOrdersToday(data, property, search);
  const checkins = orders.filter((s) => s.order_type === 'checkin').length;
  return (
    <section
      className="panel today-stay-orders"
      aria-label="Check-ins e checkouts de hoje"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">Prioridade do dia</span>
          <h2>
            <CalendarDays size={21} />
            Check-ins e checkouts de hoje
          </h2>
          <p>
            {checkins} check-in(s) · {orders.length - checkins} checkout(s)
          </p>
        </div>
      </div>
      {orders.length ? (
        orders.map((s) => (
          <WorkOrderCard key={s.id} order={s} data={data} onOpen={onOpen} />
        ))
      ) : (
        <p className="today-stay-empty">
          Nenhuma entrada ou saída programada para hoje nos filtros
          selecionados.
        </p>
      )}
    </section>
  );
}
