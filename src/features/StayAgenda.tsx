import { useState } from 'react';
import { Form, Modal } from '../components';
import { dayKey, type AgendaEntry, type Data } from '../domain';
import { rpc } from '../lib/client';

type Run = (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
const today = () => dayKey(new Date());
const displayDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR');

export default function StayAgenda({
  data,
  manager,
  property,
  run,
}: {
  data: Data;
  manager: boolean;
  property: string;
  run: Run;
}) {
  const [editing, setEditing] = useState<AgendaEntry | null>(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const entries = (data.team_agenda ?? [])
    .filter(
      (r) =>
        (!property ||
          data.units.some(
            (u) => u.id === r.unit_id && u.property_id === property,
          )) &&
        (all || r.checkout >= today()),
    )
    .sort(
      (a, b) =>
        a.checkout.localeCompare(b.checkout) ||
        a.checkin.localeCompare(b.checkin),
    );
  return (
    <section className="panel team-agenda">
      <div className="editor-section-heading">
        <div>
          <h2>Agenda da equipe</h2>
          <p className="muted">
            Entradas e saídas compartilhadas com todos que têm acesso à
            propriedade.
          </p>
        </div>
        <button className="button secondary" onClick={() => setAll(!all)}>
          {all ? 'Próximas estadias' : 'Ver histórico'}
        </button>
      </div>
      {data.agenda_ready === false ? (
        <p role="status">
          Atualização do banco pendente: aplique a migração 006 para ativar a
          agenda.
        </p>
      ) : entries.length ? (
        <div className="agenda-list">
          {entries.map((r) => {
            const unit = data.units.find((u) => u.id === r.unit_id);
            const canEdit = r.checkout_order_id
              ? r.inspection_status === 'pending' ||
                (r.checkout === today() &&
                  ['in_progress', 'correction'].includes(
                    r.inspection_status ?? '',
                  ))
              : !r.cycle_id ||
                [r.inspection_status, r.cleaning_status].every(
                  (s) => s === 'pending',
                );
            return (
              <article className="agenda-row" key={r.id}>
                <div>
                  <strong>{unit?.name}</strong>
                  <small>
                    {
                      data.properties.find((p) => p.id === unit?.property_id)
                        ?.name
                    }{' '}
                    · {r.guests} hóspede(s) · {r.duration_nights ?? 0} diária(s)
                  </small>
                </div>
                <div>
                  <small>Entrada</small>
                  <strong>{displayDate(r.checkin)}</strong>
                  {r.checkin_start_time && (
                    <small>
                      {r.checkin_start_time.slice(0, 5)}–
                      {r.checkin_end_time?.slice(0, 5)}
                    </small>
                  )}
                </div>
                <div>
                  <small>Saída</small>
                  <strong>{displayDate(r.checkout)}</strong>
                  <small>
                    {r.checkout_start_time
                      ? `${r.checkout_start_time.slice(0, 5)}–`
                      : ''}
                    {r.checkout_time.slice(0, 5)}
                  </small>
                </div>
                <span className="muted">
                  {!r.cycle_id && !r.checkout_order_id
                    ? 'Reserva anterior'
                    : (
                          r.checkout_order_id
                            ? r.inspection_status === 'completed'
                            : r.cleaning_status === 'completed'
                        )
                      ? 'Concluída'
                      : r.inspection_status === 'pending' || !r.cycle_id
                        ? 'Checkout programado'
                        : 'Em execução'}
                </span>
                {manager && canEdit && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setError('');
                      setEditing(r);
                    }}
                  >
                    Editar saída
                  </button>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="muted">Nenhuma hospedagem programada.</p>
      )}
      {editing && (
        <Modal title="Editar saída" onClose={() => setEditing(null)}>
          <p className="modal-description">
            A ordem de checkout acompanhará a nova data. A ordem de check-in
            será preservada.
          </p>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <Form
            submit="Salvar saída"
            fields={[
              ...(!editing.checkout_order_id ||
              editing.inspection_status === 'pending'
                ? [
                    {
                      name: 'checkout',
                      label: 'Nova data de saída',
                      type: 'date',
                      value: editing.checkout,
                    },
                  ]
                : []),
              {
                name: 'checkout_start_time',
                label: 'Início do checkout',
                type: 'time',
                value: (
                  editing.checkout_start_time ?? editing.checkout_time
                ).slice(0, 5),
              },
              {
                name: 'checkout_time',
                label: 'Fim do checkout',
                type: 'time',
                value: editing.checkout_time.slice(0, 5),
              },
              { name: 'reason', label: 'Motivo da alteração' },
            ]}
            onSubmit={async (payload) => {
              setError('');
              const ok = await run(async () => {
                try {
                  return await rpc('reschedule_checkout_window', {
                    reservation: editing.id,
                    expected_revision: editing.revision,
                    payload: {
                      ...payload,
                      checkout: payload.checkout || editing.checkout,
                    },
                  });
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : 'Não foi possível salvar.',
                  );
                  throw e;
                }
              }, 'Ordem de checkout atualizada na agenda da equipe.');
              if (ok) setEditing(null);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
