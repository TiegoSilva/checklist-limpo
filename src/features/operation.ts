import { dayKey, type Activity, type Data, type Service } from '../domain';
import { matchesSearch } from '../lib/search';
export function pendingApprovals(activities: Activity[], orders: Service[]) {
  return {
    activities: activities.filter(
      (a) => a.status === 'review' && !a.deleted_at,
    ),
    tasks: orders.filter(
      (s) => s.status === 'review' && !s.deleted_at && !s.activity_id,
    ),
  };
}
export function stayOrdersToday(
  data: Data,
  property = '',
  search = '',
  today = dayKey(new Date()),
) {
  return data.service_orders
    .filter((s) => {
      const unit = data.units.find((u) => u.id === s.unit_id);
      return (
        !s.deleted_at &&
        s.status !== 'cancelled' &&
        ['checkin', 'checkout'].includes(s.order_type ?? '') &&
        dayKey(new Date(s.scheduled_start_at ?? s.due_at)) === today &&
        (!property || unit?.property_id === property) &&
        matchesSearch(
          `${s.title} ${unit?.name ?? ''} ${data.properties.find((p) => p.id === unit?.property_id)?.name ?? ''} ${data.profiles.find((p) => p.id === s.assignee)?.name ?? ''}`,
          search,
        )
      );
    })
    .sort((a, b) =>
      (a.scheduled_start_at ?? a.due_at).localeCompare(
        b.scheduled_start_at ?? b.due_at,
      ),
    );
}
