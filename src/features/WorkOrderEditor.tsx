import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  House,
  LoaderCircle,
  Wrench,
} from 'lucide-react';
import { Modal } from '../components';
import { dayKey, type Data } from '../domain';
import { rpc, type Run } from '../lib/client';
import QuantityStepper from './QuantityStepper';
import { activeTemplates, templateName } from './checklists';

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
export const validTimeWindow = (start: string, end: string) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(start) &&
  /^([01]\d|2[0-3]):[0-5]\d$/.test(end) &&
  start < end;
type Mode = 'task' | 'checklist';
export type OrderDraft = {
  intent: 'checkin' | 'task';
  unit: string;
  title: string;
  description: string;
  arrival: string;
  nights: number;
  guests: number;
  occupancy: number;
  model: string;
  checkinMode: Mode | 'auto';
  assignee: string;
  outAssignee: string;
  due: string;
  checkinTime: string;
  checkoutTime: string;
  checkinEndTime: string;
  checkoutEndTime: string;
  checkinOrder: string;
  priority: string;
  blocking: boolean;
  finding: string;
};
export function orderStaff(
  data: Data,
  unit: string,
  role?: 'cleaner' | 'inspector',
) {
  const org = data.properties.find(
    (p) => p.id === data.units.find((u) => u.id === unit)?.property_id,
  )?.org_id;
  return data.profiles.filter(
    (p) =>
      p.active &&
      data.memberships.some(
        (m) =>
          m.user_id === p.id &&
          (!org || m.org_id === org) &&
          (!role || m.roles.includes(role)),
      ),
  );
}
export function initialOrderDraft(
  data: Data,
  _type: 'general' | 'checkin' = 'general',
): OrderDraft {
  const unit = data.units.length === 1 ? data.units[0].id : '';
  const staff = orderStaff(data, unit, 'cleaner'),
    inspectors = orderStaff(data, unit, 'inspector');
  return {
    intent: 'checkin',
    unit,
    title: '',
    description: '',
    arrival: dayKey(new Date()),
    nights: 1,
    guests: 1,
    occupancy: data.units.find((u) => u.id === unit)?.base_occupancy ?? 1,
    model: '',
    checkinMode: 'auto',
    assignee: staff.length === 1 ? staff[0].id : '',
    outAssignee: inspectors.length === 1 ? inspectors[0].id : '',
    due: '',
    checkinTime: '13:30',
    checkinEndTime: '15:00',
    checkoutTime: '11:30',
    checkoutEndTime: '12:30',
    checkinOrder: '',
    priority: 'normal',
    blocking: false,
    finding: '',
  };
}
export function orderPlan(data: Data, d: OrderDraft) {
  const models = activeTemplates(data.checklist_template_versions).filter(
    (t) => t.unit_id === d.unit,
  );
  const incoming = models.filter(
    (t) => d.intent !== 'checkin' || t.kind === 'cleaning',
  );
  const model = incoming.find((t) => t.id === d.model) ?? incoming[0];
  const mode: Mode =
    d.intent === 'task'
      ? 'task'
      : d.checkinMode === 'auto'
        ? model
          ? 'checklist'
          : 'task'
        : d.checkinMode;
  const outMode: Mode =
    mode === 'checklist' &&
    model?.items.some(
      (i) =>
        i.mode === 'count' &&
        (!i.min_guests || d.guests >= i.min_guests) &&
        (!i.max_guests || d.guests <= i.max_guests),
    )
      ? 'checklist'
      : 'task';
  return { incoming, model, mode, outMode };
}
export function orderStepError(
  data: Data,
  d: OrderDraft,
  step: number,
): string {
  const unit = data.units.find((u) => u.id === d.unit),
    plan = orderPlan(data, d);
  if (step === 1) {
    if (!unit) return 'Escolha a unidade.';
    if (d.intent === 'checkin') {
      if (!d.title.trim()) return 'Informe o nome do hóspede.';
      if (!departureDate(d.arrival, d.nights) || d.nights > 3650)
        return 'Informe a entrada e uma duração de 1 a 3650 diárias.';
      if (
        !Number.isInteger(d.guests) ||
        d.guests < 1 ||
        d.guests > unit.capacity
      )
        return `A unidade recebe até ${unit.capacity} hóspedes.`;
    } else if (d.intent === 'task' && !d.title.trim())
      return 'Descreva a tarefa que precisa ser feita.';
  }
  if (step === 2) {
    if (
      !orderStaff(
        data,
        d.unit,
        d.intent === 'checkin' ? 'cleaner' : undefined,
      ).some((p) => p.id === d.assignee)
    )
      return 'Escolha o responsável pela ordem.';
    if (d.intent === 'checkin') {
      if (
        !orderStaff(data, d.unit, 'inspector').some(
          (p) => p.id === d.outAssignee,
        )
      )
        return 'Escolha o responsável pelo checkout.';
      if (plan.mode === 'checklist' && !plan.model)
        return 'Escolha um modelo ativo de check-in ou use tarefa simples.';
      if (
        !validTimeWindow(d.checkinTime, d.checkinEndTime) ||
        !validTimeWindow(d.checkoutTime, d.checkoutEndTime)
      )
        return 'Informe faixas válidas: o fim deve ser depois do início.';
    } else if (!d.due || !Number.isFinite(new Date(d.due).getTime()))
      return 'Informe a data e o horário do prazo.';
  }
  return '';
}
export function buildOrderPayload(data: Data, d: OrderDraft, id: string) {
  for (const step of [1, 2]) {
    const error = orderStepError(data, d, step);
    if (error) throw new Error(error);
  }
  const plan = orderPlan(data, d),
    stay = d.intent === 'checkin';
  return {
    event_id: id,
    unit_id: d.unit,
    order_type: stay ? 'checkin' : 'general',
    execution_mode: plan.mode,
    template_id: plan.mode === 'checklist' ? plan.model?.id : null,
    assignee: d.assignee,
    description: d.description.trim(),
    ...(stay
      ? {
          guest_name: d.title.trim(),
          checkin: d.arrival,
          duration_nights: d.nights,
          guests: d.guests,
          checkin_start_time: d.checkinTime,
          checkin_time: d.checkinEndTime,
          checkout_start_time: d.checkoutTime,
          checkout_time: d.checkoutEndTime,
          checkout_assignee: d.outAssignee,
        }
      : {
          checkin_order_id: d.checkinOrder || null,
          title: d.title.trim(),
          due_at: new Date(d.due).toISOString(),
          occupancy: d.occupancy,
          priority: d.priority,
          blocking: d.blocking,
          finding_id: d.finding || null,
        }),
  };
}
const steps = ['Tipo', 'Detalhes', 'Programação', 'Revisão'];
const shortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
  });

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
  const [draft, setDraft] = useState(() =>
    initialOrderDraft(data, initialType),
  );
  const [step, setStep] = useState(initialType === 'checkin' ? 1 : 0);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const patch = (value: Partial<OrderDraft>) =>
    setDraft((prev) => ({ ...prev, ...value }));
  const stay = draft.intent === 'checkin',
    plan = orderPlan(data, draft),
    unit = data.units.find((u) => u.id === draft.unit);
  const departure = departureDate(draft.arrival, draft.nights);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start' });
  }, [step]);
  const chooseUnit = (value: string) => {
    const staff = orderStaff(data, value, stay ? 'cleaner' : undefined),
      inspectors = orderStaff(data, value, 'inspector');
    patch({
      unit: value,
      model: '',
      checkinOrder: '',
      occupancy: data.units.find((u) => u.id === value)?.base_occupancy ?? 1,
      assignee: staff.some((p) => p.id === draft.assignee)
        ? draft.assignee
        : staff.length === 1
          ? staff[0].id
          : '',
      outAssignee: inspectors.some((p) => p.id === draft.outAssignee)
        ? draft.outAssignee
        : inspectors.length === 1
          ? inspectors[0].id
          : '',
    });
  };
  const personField = (out = false) => {
    const people = orderStaff(
      data,
      draft.unit,
      out ? 'inspector' : stay ? 'cleaner' : undefined,
    );
    return (
      <label className="field">
        <span>
          {out
            ? 'Responsável pelo checkout'
            : stay
              ? 'Responsável pelo check-in'
              : 'Responsável'}
        </span>
        <select
          required
          value={out ? draft.outAssignee : draft.assignee}
          onChange={(e) =>
            patch(
              out
                ? { outAssignee: e.target.value }
                : { assignee: e.target.value },
            )
          }
        >
          <option value="">Escolha uma pessoa</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {!people.length && (
          <small>
            Cadastre uma pessoa com a função e o acesso necessários.
          </small>
        )}
      </label>
    );
  };
  const titles = [
    'O que vamos organizar?',
    stay ? 'Conte sobre a estadia' : 'O que precisa ser feito?',
    stay ? 'Quem cuida de cada etapa?' : 'Quem faz e para quando?',
    'Tudo pronto para criar?',
  ];
  const descriptions = [
    'Uma escolha. Só os campos que você precisa.',
    stay
      ? 'A saída é calculada automaticamente, sem preencher a mesma informação duas vezes.'
      : 'Comece pela unidade e pelo trabalho a realizar.',
    stay
      ? 'O checkout será agendado junto com o check-in.'
      : 'Defina uma pessoa e o prazo para a conclusão.',
    'Confira os detalhes antes de confirmar.',
  ];
  return (
    <Modal
      title="Nova ordem de serviço"
      onClose={onClose}
      className="wizard-modal"
      wide
    >
      <nav className="wizard-progress" aria-label="Etapas da ordem">
        <ol>
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={step === index ? 'step' : undefined}
              className={index <= step ? 'reached' : ''}
            >
              <button
                type="button"
                disabled={saving || index > step}
                onClick={() => {
                  setError('');
                  setStep(index);
                }}
              >
                <span>{index < step ? <Check size={13} /> : index + 1}</span>
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ol>
        <p>
          Passo {step + 1} de {steps.length}
        </p>
      </nav>
      <form
        className="wizard-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          if (step < 3) {
            const message = orderStepError(data, draft, step);
            if (message) {
              setError(message);
              return;
            }
            setStep(step + 1);
            return;
          }
          setSaving(true);
          try {
            const payload = buildOrderPayload(data, draft, id);
            const ok = await run(
              async () => {
                try {
                  return await rpc('create_scheduled_work_order', { payload });
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : 'Não foi possível criar a ordem.',
                  );
                  throw err;
                }
              },
              stay ? 'Check-in e checkout criados.' : 'Ordem criada.',
            );
            if (ok) onClose();
          } catch (err) {
            setError(
              err instanceof Error ? err.message : 'Revise os dados da ordem.',
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="wizard-body">
          <div className="wizard-heading">
            <h2 ref={heading} tabIndex={-1}>
              {titles[step]}
            </h2>
            <p>{descriptions[step]}</p>
          </div>
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          {step === 0 && (
            <div className="order-choices">
              {[
                {
                  id: 'checkin' as const,
                  label: 'Check-in',
                  text: 'Organize a estadia e agende o checkout.',
                  Icon: House,
                },
                {
                  id: 'task' as const,
                  label: 'Tarefa',
                  text: 'Um serviço ou cuidado específico.',
                  Icon: Wrench,
                },
              ].map(({ id, label, text, Icon }) => (
                <label
                  className={`order-choice ${draft.intent === id ? 'selected' : ''}`}
                  key={id}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name="order-intent"
                    value={id}
                    checked={draft.intent === id}
                    onChange={() => {
                      const staff = orderStaff(
                        data,
                        draft.unit,
                        id === 'checkin' ? 'cleaner' : undefined,
                      );
                      patch({
                        intent: id,
                        title: '',
                        assignee: staff.some((p) => p.id === draft.assignee)
                          ? draft.assignee
                          : staff.length === 1
                            ? staff[0].id
                            : '',
                      });
                    }}
                  />
                  <Icon size={26} />
                  <span>
                    <strong>{label}</strong>
                    <small>{text}</small>
                  </span>
                  <span className="choice-dot" aria-hidden="true" />
                </label>
              ))}
            </div>
          )}
          {step === 1 && (
            <div className="wizard-fields">
              <label className="field">
                <span>Unidade</span>
                <select
                  required
                  value={draft.unit}
                  onChange={(e) => chooseUnit(e.target.value)}
                >
                  <option value="">Onde será a ordem?</option>
                  {data.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {
                        data.properties.find((p) => p.id === u.property_id)
                          ?.name
                      }{' '}
                      · {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{stay ? 'Nome do hóspede' : 'Qual é a tarefa?'}</span>
                {stay ? (
                  <input
                    required
                    autoComplete="off"
                    value={draft.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="Nome da reserva"
                  />
                ) : (
                  <textarea
                    required
                    rows={2}
                    value={draft.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="Ex.: trocar a lâmpada da cozinha"
                  />
                )}
              </label>

              {stay && (
                <>
                  <label className="field">
                    <span>Data de entrada</span>
                    <input
                      type="date"
                      required
                      value={draft.arrival}
                      onChange={(e) => patch({ arrival: e.target.value })}
                    />
                  </label>
                  <div className="number-setting">
                    <div>
                      <strong>Diárias</strong>
                      <small>Duração da estadia</small>
                    </div>
                    <QuantityStepper
                      label="Diárias da estadia"
                      min={1}
                      max={3650}
                      value={draft.nights}
                      onChange={(nights) => patch({ nights })}
                    />
                  </div>
                  <div className="number-setting">
                    <div>
                      <strong>Hóspedes</strong>
                      <small>
                        {unit
                          ? `Até ${unit.capacity} pessoas`
                          : 'Quantidade de pessoas'}
                      </small>
                    </div>
                    <QuantityStepper
                      label="Quantidade de hóspedes"
                      min={1}
                      max={unit?.capacity ?? 9999}
                      value={draft.guests}
                      onChange={(guests) => patch({ guests })}
                    />
                  </div>
                  {departure && (
                    <div className="stay-date-note">
                      <CalendarDays size={20} />
                      <span>
                        Checkout em <strong>{shortDate(departure)}</strong>
                        <small>Agendado automaticamente</small>
                      </span>
                    </div>
                  )}
                </>
              )}
              {!stay && (
                <details className="wizard-options">
                  <summary>Adicionar instruções (opcional)</summary>
                  <label className="field">
                    <span>Instruções para a equipe</span>
                    <textarea
                      rows={3}
                      value={draft.description}
                      onChange={(e) => patch({ description: e.target.value })}
                    />
                  </label>
                </details>
              )}
            </div>
          )}
          {step === 2 && (
            <div className="wizard-fields">
              {personField()}
              {stay ? (
                personField(true)
              ) : (
                <label className="field">
                  <span>Data e horário do prazo</span>
                  <input
                    type="datetime-local"
                    required
                    value={draft.due}
                    onChange={(e) => patch({ due: e.target.value })}
                  />
                </label>
              )}
              {stay ? (
                <>
                  <div className="stay-date-note">
                    <CalendarDays size={20} />
                    <span>
                      {shortDate(draft.arrival)} —{' '}
                      {departure ? shortDate(departure) : '—'}
                      <small>
                        {draft.nights} diária(s) · {draft.guests} hóspede(s)
                      </small>
                    </span>
                  </div>
                  <p className="wizard-hint">
                    {plan.mode === 'checklist'
                      ? 'Modelo de check-in incluído'
                      : 'Check-in como tarefa simples'}{' '}
                    ·{' '}
                    {plan.outMode === 'checklist'
                      ? 'Checkout gerado com os itens do check-in'
                      : 'Checkout como tarefa simples'}
                  </p>
                  <label className="field">
                    <span>Modelo de check-in</span>
                    <select
                      value={
                        plan.mode === 'task'
                          ? 'task'
                          : (plan.model?.id ?? 'task')
                      }
                      onChange={(e) =>
                        patch({
                          checkinMode:
                            e.target.value === 'task' ? 'task' : 'checklist',
                          model:
                            e.target.value === 'task' ? '' : e.target.value,
                        })
                      }
                    >
                      <option value="task">Tarefa simples (sem modelo)</option>
                      {plan.incoming.map((t) => (
                        <option key={t.id} value={t.id}>
                          {templateName(t)}
                        </option>
                      ))}
                    </select>
                    <small>
                      O checkout usa os mesmos itens e quantidades deste
                      check-in, sem escolher outro modelo.
                    </small>
                  </label>
                  <div className="wizard-fields">
                    <div className="two-cols">
                      <label className="field">
                        <span>Check-in · início</span>
                        <input
                          type="time"
                          required
                          value={draft.checkinTime}
                          onChange={(e) =>
                            patch({ checkinTime: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Check-in · fim</span>
                        <input
                          type="time"
                          required
                          value={draft.checkinEndTime}
                          onChange={(e) =>
                            patch({ checkinEndTime: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Checkout · início</span>
                        <input
                          type="time"
                          required
                          value={draft.checkoutTime}
                          onChange={(e) =>
                            patch({ checkoutTime: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Checkout · fim</span>
                        <input
                          type="time"
                          required
                          value={draft.checkoutEndTime}
                          onChange={(e) =>
                            patch({ checkoutEndTime: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span>Observações (opcional)</span>
                      <textarea
                        rows={2}
                        value={draft.description}
                        onChange={(e) => patch({ description: e.target.value })}
                      />
                    </label>
                  </div>
                </>
              ) : (
                <details className="wizard-options">
                  <summary>Prioridade e outras opções</summary>
                  <div className="wizard-fields">
                    <label className="field">
                      <span>Check-in de origem (opcional)</span>
                      <select
                        value={draft.checkinOrder}
                        onChange={(e) =>
                          patch({ checkinOrder: e.target.value })
                        }
                      >
                        <option value="">Ordem avulsa</option>
                        {data.service_orders
                          .filter(
                            (o) =>
                              o.unit_id === draft.unit &&
                              o.order_type === 'checkin' &&
                              !o.deleted_at &&
                              o.status !== 'cancelled',
                          )
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {new Date(o.due_at).toLocaleDateString('pt-BR')} ·{' '}
                              {o.title} · #{o.id.slice(0, 8)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Prioridade</span>
                      <select
                        value={draft.priority}
                        onChange={(e) => patch({ priority: e.target.value })}
                      >
                        <option value="normal">Normal</option>
                        <option value="high">Alta</option>
                        <option value="urgent">Urgente</option>
                      </select>
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={draft.blocking}
                        onChange={(e) => patch({ blocking: e.target.checked })}
                      />
                      Impede a liberação da unidade
                    </label>
                    <label className="field">
                      <span>Ocorrência vinculada</span>
                      <select
                        value={draft.finding}
                        onChange={(e) => patch({ finding: e.target.value })}
                      >
                        <option value="">Nenhuma</option>
                        {data.findings
                          .filter(
                            (f) =>
                              !f.resolved_at &&
                              data.activities.some(
                                (a) =>
                                  a.id === f.activity_id &&
                                  a.unit_id === draft.unit,
                              ),
                          )
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                </details>
              )}
            </div>
          )}
          {step === 3 && (
            <div className="order-review">
              <div className="review-kind">
                <span className="review-icon">
                  {stay ? <House /> : <Wrench />}
                </span>
                <div>
                  <small>{stay ? 'Check-in + checkout' : 'Tarefa'}</small>
                  <h3>{unit?.name}</h3>
                </div>
              </div>
              <dl>
                {stay ? (
                  <>
                    <div>
                      <dt>Hóspede</dt>
                      <dd>{draft.title}</dd>
                    </div>
                    <div>
                      <dt>Estadia</dt>
                      <dd>
                        {shortDate(draft.arrival)} — {shortDate(departure)}
                        <small>
                          {draft.nights} diária(s) · {draft.guests} hóspede(s)
                        </small>
                      </dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>Tarefa</dt>
                    <dd>{draft.title}</dd>
                  </div>
                )}
                <div>
                  <dt>{stay ? 'Check-in' : 'Responsável'}</dt>
                  <dd>
                    {data.profiles.find((p) => p.id === draft.assignee)?.name}
                    {stay && (
                      <small>
                        {draft.checkinTime}–{draft.checkinEndTime} ·{' '}
                        {plan.mode === 'checklist'
                          ? plan.model
                            ? templateName(plan.model)
                            : 'Checklist'
                          : 'Tarefa simples'}
                      </small>
                    )}
                  </dd>
                </div>
                {stay ? (
                  <div>
                    <dt>Checkout</dt>
                    <dd>
                      {
                        data.profiles.find((p) => p.id === draft.outAssignee)
                          ?.name
                      }
                      <small>
                        {shortDate(departure)} · {draft.checkoutTime}–
                        {draft.checkoutEndTime} ·{' '}
                        {plan.outMode === 'checklist'
                          ? 'Itens do check-in'
                          : 'Tarefa simples'}
                      </small>
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt>Prazo</dt>
                    <dd>
                      {draft.due
                        ? new Date(draft.due).toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </dd>
                  </div>
                )}
                {draft.description && (
                  <div>
                    <dt>Instruções</dt>
                    <dd>{draft.description}</dd>
                  </div>
                )}
              </dl>
              <p className="review-notice">
                <Check size={18} />
                {stay
                  ? 'Duas ordens vinculadas serão criadas na agenda da equipe.'
                  : 'A ordem será enviada ao responsável.'}
              </p>
            </div>
          )}
        </div>
        <footer className="wizard-footer">
          <button
            type="button"
            className="wizard-back"
            disabled={saving}
            onClick={() => {
              if (step === 0) onClose();
              else {
                setError('');
                setStep(step - 1);
              }
            }}
          >
            <ArrowLeft size={18} />
            {step === 0 ? 'Cancelar' : 'Voltar'}
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? (
              <>
                <LoaderCircle className="spin" size={18} />
                Criando…
              </>
            ) : step === 3 ? (
              <>
                <Check size={18} />
                {stay ? 'Criar as duas ordens' : 'Criar ordem'}
              </>
            ) : (
              <>
                Continuar
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
