import { useState } from 'react';
import { Modal } from '../components';
import { dayKey, type Data } from '../domain';
import { rpc, type Run } from '../lib/client';
import QuantityStepper from './QuantityStepper';
import { checklistLabel, latestTemplates } from './checklists';

export function departureDate(arrival: string, nights: number) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(arrival) ||
    !Number.isInteger(nights) ||
    nights < 1
  )
    return '';
  const d = new Date(`${arrival}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + nights);
  return d.toISOString().slice(0, 10);
}

export default function WorkOrderEditor({
  data,
  run,
  onClose,
  initialType = 'general',
}: {
  data: Data;
  run: Run;
  onClose: () => void;
  initialType?: 'general' | 'checkin';
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [type, setType] = useState(initialType);
  const [unit, setUnit] = useState(
    data.units.length === 1 ? data.units[0].id : '',
  );
  const [mode, setMode] = useState<'task' | 'checklist'>(
    initialType === 'checkin' ? 'checklist' : 'task',
  );
  const [outMode, setOutMode] = useState<'task' | 'checklist'>('checklist');
  const [arrival, setArrival] = useState(dayKey(new Date()));
  const [nights, setNights] = useState(1);
  const [guests, setGuests] = useState(1);
  const [model, setModel] = useState('');
  const [outModel, setOutModel] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const templates = latestTemplates(data.checklist_template_versions).filter(
    (t) => t.unit_id === unit,
  );
  const models = templates.filter(
    (t) => type !== 'checkin' || t.kind === 'cleaning',
  );
  const outModels = templates.filter((t) => t.kind === 'inspection');
  const selected = models.some((t) => t.id === model)
    ? model
    : (models[0]?.id ?? '');
  const selectedOut = outModels.some((t) => t.id === outModel)
    ? outModel
    : (outModels[0]?.id ?? '');
  const people = (role?: 'inspector' | 'cleaner') =>
    data.profiles.filter(
      (p) =>
        p.active &&
        (!role ||
          data.memberships.some(
            (m) => m.user_id === p.id && m.roles.includes(role),
          )),
    );
  const personField = (
    name: string,
    label: string,
    role?: 'inspector' | 'cleaner',
  ) => (
    <label className="field">
      <span>{label}</span>
      <select
        name={name}
        required
        defaultValue={people(role).length === 1 ? people(role)[0].id : ''}
      >
        <option value="">Selecione</option>
        {people(role).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
  const modelField = (
    value: string,
    list: typeof models,
    set: (id: string) => void,
  ) => (
    <label className="field">
      <span>Modelo de checklist</span>
      <select required value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Selecione</option>
        {list.map((t) => (
          <option key={t.id} value={t.id}>
            {checklistLabel(t.kind)} · v{t.version}
          </option>
        ))}
      </select>
      {!list.length && (
        <small>Cadastre um modelo compatível para esta unidade.</small>
      )}
    </label>
  );
  const departure = departureDate(arrival, nights);
  return (
    <Modal title="Nova ordem de serviço" onClose={onClose} wide>
      <p className="modal-description">
        Escolha um modelo de checklist para executar ou descreva uma tarefa
        simples.
      </p>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <form
        className="form work-order-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setSaving(true);
          const values = Object.fromEntries(
            new FormData(e.currentTarget).entries(),
          );
          const payload = {
            ...values,
            event_id: id,
            unit_id: unit,
            order_type: type,
            execution_mode: mode,
            template_id: mode === 'checklist' ? selected : null,
            ...(type === 'checkin'
              ? {
                  checkin: arrival,
                  duration_nights: nights,
                  guests,
                  checkout_execution_mode: outMode,
                  checkout_template_id:
                    outMode === 'checklist' ? selectedOut : null,
                }
              : { due_at: new Date(String(values.due_at)).toISOString() }),
          };
          try {
            const ok = await run(
              async () => {
                try {
                  return await rpc('create_work_order', { payload });
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : 'Não foi possível criar a ordem.',
                  );
                  throw err;
                }
              },
              type === 'checkin'
                ? 'Ordens de check-in e checkout criadas.'
                : 'Ordem de serviço criada.',
            );
            if (ok) onClose();
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="two-cols">
          <label className="field">
            <span>Tipo de ordem</span>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setModel('');
              }}
            >
              <option value="general">Serviço ou tarefa</option>
              <option value="checkin">Check-in com checkout automático</option>
            </select>
          </label>
          <label className="field">
            <span>Unidade</span>
            <select
              required
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              <option value="">Selecione</option>
              {data.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>O que será executado?</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="task">Tarefa simples</option>
              <option value="checklist">Modelo de checklist</option>
            </select>
          </label>
          {mode === 'checklist' && modelField(selected, models, setModel)}
          {type === 'general' && (
            <label className="field">
              <span>{mode === 'task' ? 'Tarefa' : 'Título da ordem'}</span>
              <input
                name="title"
                required
                placeholder="Ex.: trocar a lâmpada"
              />
            </label>
          )}
          {personField(
            'assignee',
            type === 'checkin' ? 'Responsável pelo check-in' : 'Responsável',
            type === 'checkin' ? 'cleaner' : undefined,
          )}
          {type === 'general' && (
            <label className="field">
              <span>Prazo</span>
              <input name="due_at" type="datetime-local" required />
            </label>
          )}
        </div>
        {type === 'checkin' && (
          <>
            <section className="editor-section">
              <h3>Hospedagem</h3>
              <div className="two-cols">
                <label className="field">
                  <span>Hóspede</span>
                  <input name="guest_name" required />
                </label>
                <label className="field">
                  <span>Data de entrada</span>
                  <input
                    type="date"
                    value={arrival}
                    required
                    onChange={(e) => setArrival(e.target.value)}
                  />
                </label>
                <div className="field">
                  <span>Duração da estadia (diárias)</span>
                  <QuantityStepper
                    label="Diárias da estadia"
                    min={1}
                    max={3650}
                    value={nights}
                    onChange={setNights}
                  />
                </div>
                <div className="field">
                  <span>Quantidade de hóspedes</span>
                  <QuantityStepper
                    label="Quantidade de hóspedes"
                    min={1}
                    max={
                      data.units.find((u) => u.id === unit)?.capacity ?? 9999
                    }
                    value={guests}
                    onChange={setGuests}
                  />
                </div>
              </div>
            </section>
            <section className="editor-section">
              <h3>Checkout automático</h3>
              <p className="info-card">
                Saída prevista:{' '}
                <strong>
                  {departure
                    ? new Date(`${departure}T12:00:00`).toLocaleDateString(
                        'pt-BR',
                      )
                    : 'Escolha a entrada'}
                </strong>{' '}
                · {nights} diária(s) · {guests} hóspede(s)
              </p>
              <div className="two-cols">
                <label className="field">
                  <span>Execução do checkout</span>
                  <select
                    value={outMode}
                    onChange={(e) =>
                      setOutMode(e.target.value as typeof outMode)
                    }
                  >
                    <option value="checklist">Modelo de checklist</option>
                    <option value="task">Tarefa simples de checkout</option>
                  </select>
                </label>
                {outMode === 'checklist' &&
                  modelField(selectedOut, outModels, setOutModel)}
                {personField(
                  'checkout_assignee',
                  'Responsável pelo checkout',
                  'inspector',
                )}
              </div>
              <details className="item-options">
                <summary>Horários</summary>
                <div className="two-cols">
                  <label className="field">
                    <span>Check-in</span>
                    <input
                      name="checkin_time"
                      type="time"
                      defaultValue="14:00"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Checkout</span>
                    <input
                      name="checkout_time"
                      type="time"
                      defaultValue="12:00"
                      required
                    />
                  </label>
                </div>
              </details>
            </section>
          </>
        )}
        {type === 'general' && (
          <details className="item-options">
            <summary>Prioridade e outras opções</summary>
            <div className="two-cols">
              <label className="field">
                <span>Prioridade</span>
                <select name="priority" defaultValue="normal">
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </label>
              <label className="field">
                <span>Impede a liberação?</span>
                <select name="blocking" defaultValue="false">
                  <option value="false">Não</option>
                  <option value="true">Sim</option>
                </select>
              </label>
              <label className="field">
                <span>Ocorrência vinculada</span>
                <select name="finding_id" defaultValue="">
                  <option value="">Nenhuma</option>
                  {data.findings
                    .filter(
                      (f) =>
                        !f.resolved_at &&
                        data.activities.some(
                          (a) => a.id === f.activity_id && a.unit_id === unit,
                        ),
                    )
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                </select>
              </label>
              {mode === 'checklist' && (
                <label className="field">
                  <span>Ocupação para as quantidades do modelo</span>
                  <input
                    name="occupancy"
                    type="number"
                    min={1}
                    max={data.units.find((u) => u.id === unit)?.capacity}
                    defaultValue={
                      data.units.find((u) => u.id === unit)?.base_occupancy ?? 1
                    }
                    key={unit}
                  />
                </label>
              )}
            </div>
          </details>
        )}
        <label className="field">
          <span>
            {mode === 'task'
              ? 'Instruções da tarefa (opcional)'
              : 'Observações da ordem (opcional)'}
          </span>
          <textarea name="description" rows={2} />
        </label>
        <button type="submit" className="button primary" disabled={saving}>
          {saving
            ? 'Criando…'
            : type === 'checkin'
              ? 'Criar check-in e checkout'
              : 'Criar ordem'}
        </button>
      </form>
    </Modal>
  );
}
