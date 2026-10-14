import { useState } from 'react';
import { Form, Modal } from '../components';
import { dayKey, type AgendaEntry, type Data } from '../domain';
import { rpc } from '../lib/client';

type Run = (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
const today = () => dayKey(new Date());
const displayDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR');

export function CheckinForm({
  data,
  run,
  onClose,
}: {
  data: Data;
  run: Run;
  onClose: () => void;
}) {
  const [eventId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const people = (role: 'inspector' | 'cleaner') =>
    data.profiles
      .filter(
        (p) =>
          p.active &&
          data.memberships.some(
            (m) => m.user_id === p.id && m.roles.includes(role),
          ),
      )
      .map((p) => ({ value: p.id, label: p.name }));
  return (
    <Modal title="Registrar check-in" onClose={onClose} wide>
      <p className="modal-description">
        A saída cria automaticamente a vistoria e a limpeza na agenda da equipe.
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="stay-form">
        <Form
          submit="Registrar e programar checkout"
          fields={[
            {
              name: 'unit_id',
              label: 'Unidade',
              options: data.units.map((u) => ({
                value: u.id,
                label: `${data.properties.find((p) => p.id === u.property_id)?.name ?? ''} · ${u.name}`,
              })),
            },
            { name: 'guest_name', label: 'Nome do hóspede' },
            {
              name: 'guests',
              label: 'Hóspedes',
              type: 'number',
              min: 1,
              value: '1',
            },
            { name: 'checkin', label: 'Entrada', type: 'date', value: today() },
            {
              name: 'checkout',
              label: 'Saída',
              type: 'date',
              value: dayKey(tomorrow),
            },
            {
              name: 'checkout_time',
              label: 'Horário de saída',
              type: 'time',
              value: '12:00',
            },
            {
              name: 'inspector',
              label: 'Vistoria',
              options: people('inspector'),
              value:
                people('inspector').length === 1
                  ? people('inspector')[0].value
                  : '',
            },
            {
              name: 'cleaner',
              label: 'Limpeza',
              options: people('cleaner'),
              value:
                people('cleaner').length === 1
                  ? people('cleaner')[0].value
                  : '',
            },
          ]}
          onSubmit={async (values) => {
            setError('');
            const ok = await run(async () => {
              try {
                return await rpc('register_checkin', {
                  payload: { ...values, event_id: eventId },
                });
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Não foi possível registrar.',
                );
                throw e;
              }
            }, 'Check-in registrado e checkout programado.');
            if (ok) onClose();
          }}
        />
      </div>
    </Modal>
  );
}

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
            const canEdit =
              !r.cycle_id ||
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
                    · {r.guests} hóspede(s)
                  </small>
                </div>
                <div>
                  <small>Entrada</small>
                  <strong>{displayDate(r.checkin)}</strong>
                </div>
                <div>
                  <small>Saída</small>
                  <strong>
                    {displayDate(r.checkout)} · {r.checkout_time.slice(0, 5)}
                  </strong>
                </div>
                <span className="muted">
                  {!r.cycle_id
                    ? 'Reserva anterior'
                    : r.cleaning_status === 'completed'
                      ? 'Concluída'
                      : canEdit
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
            A vistoria e a limpeza acompanharão a nova data.
          </p>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <Form
            submit="Salvar saída"
            fields={[
              {
                name: 'checkout',
                label: 'Nova data de saída',
                type: 'date',
                value: editing.checkout,
              },
              {
                name: 'checkout_time',
                label: 'Horário',
                type: 'time',
                value: editing.checkout_time.slice(0, 5),
              },
              { name: 'reason', label: 'Motivo da alteração' },
            ]}
            onSubmit={async (payload) => {
              setError('');
              const ok = await run(async () => {
                try {
                  return await rpc('reschedule_checkout', {
                    reservation: editing.id,
                    expected_revision: editing.revision,
                    payload,
                  });
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : 'Não foi possível salvar.',
                  );
                  throw e;
                }
              }, 'Saída e tarefas atualizadas na agenda da equipe.');
              if (ok) setEditing(null);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
