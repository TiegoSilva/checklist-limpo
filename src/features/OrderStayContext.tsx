import { useState } from 'react';
import { Form } from '../components';
import { dayKey, dateTime, type Data, type Service } from '../domain';
import { rpc, type Run } from '../lib/client';

export const serviceWindow = (s: Service) =>
  s.scheduled_start_at
    ? `${dateTime(s.scheduled_start_at)}–${new Date(s.due_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : dateTime(s.due_at);

export function canAdjustCheckout(
  s: Service,
  date: string,
  today = dayKey(new Date()),
) {
  return (
    s.order_type === 'checkout' &&
    (s.status === 'assigned' ||
      (['in_progress', 'rejected'].includes(s.status) && date === today))
  );
}

export default function OrderStayContext({
  order,
  data,
  manager,
  run,
}: {
  order: Service;
  data: Data;
  manager: boolean;
  run: Run;
}) {
  const [error, setError] = useState('');
  const stay = data.team_agenda.find((r) => r.id === order.reservation_id);
  const origin = order.checkin_order_id ?? order.parent_order_id;
  return (
    <section className="order-stay-context">
      <p className="muted">
        Programação: <strong>{serviceWindow(order)}</strong>
      </p>
      {origin && (
        <p className="muted">
          Check-in de origem #{origin.slice(0, 8)}
          {stay
            ? ` · ${new Date(`${stay.checkin}T12:00:00`).toLocaleDateString('pt-BR')} · ${stay.guests} hóspedes`
            : ''}
        </p>
      )}
      {manager && stay && canAdjustCheckout(order, stay.checkout) && (
        <details className="wizard-options">
          <summary>Alterar programação do checkout</summary>
          <p className="muted">
            A janela de execução será atualizada na agenda da equipe. O check-in
            e as respostas registradas serão preservados.
          </p>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <Form
            key={`${stay.id}:${stay.revision}`}
            submit="Salvar programação"
            fields={[
              ...(order.status === 'assigned'
                ? [
                    {
                      name: 'checkout',
                      label: 'Dia do checkout',
                      type: 'date',
                      value: stay.checkout,
                    },
                  ]
                : []),
              {
                name: 'checkout_start_time',
                label: 'Início do checkout',
                type: 'time',
                value: (stay.checkout_start_time ?? stay.checkout_time).slice(
                  0,
                  5,
                ),
              },
              {
                name: 'checkout_time',
                label: 'Fim do checkout',
                type: 'time',
                value: stay.checkout_time.slice(0, 5),
              },
              { name: 'reason', label: 'Motivo da alteração' },
            ]}
            onSubmit={async (values) => {
              setError('');
              await run(async () => {
                try {
                  return await rpc('reschedule_checkout_window', {
                    reservation: stay.id,
                    expected_revision: stay.revision,
                    payload: {
                      ...values,
                      checkout: values.checkout || stay.checkout,
                    },
                  });
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : 'Não foi possível atualizar.',
                  );
                  throw e;
                }
              }, 'Programação do checkout atualizada.');
            }}
          />
        </details>
      )}
    </section>
  );
}
