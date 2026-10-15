import { useState, useEffect, useRef } from 'react';
import {
  Users,
  Sparkles,
  House,
  AlertTriangle,
  Save,
  Plus,
  Image,
  Send,
  CheckCheck,
  X,
} from 'lucide-react';
import { Modal, Form, Badge } from '../components';
import OrderStayContext from './OrderStayContext';
import OrderManagement from './OrderManagement';
import {
  executionResponses,
  itemResponse,
  updateItemResponse,
  sendExecution,
  MAX_EXECUTION_PHOTOS,
} from './execution';
import ExecutionPhotos from './ExecutionPhotos';
import {
  dateTime,
  dayKey,
  progress,
  type Data,
  type Activity,
  type Response,
} from '../domain';
import {
  rpc,
  getDraft,
  saveDraft,
  removeDraft,
  signedImage,
  uploadPhoto,
  type ExecutionPhoto,
  type Draft,
  type Run,
} from '../lib/client';
const isDone = (a: Activity) => ['completed', 'cancelled'].includes(a.status);
const dueDefault = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export default function ActivityDetail({
  activity: a,
  data,
  user,
  manager,
  busy,
  run,
  onClose,
  unitName,
  person,
}: {
  activity: Activity;
  data: Data;
  user: string;
  manager: boolean;
  busy: boolean;
  run: Run;
  onClose: () => void;
  unitName: (id: string) => string;
  person: (id: string) => string;
}) {
  const previousReview = data.checklist_review_cycles.find(
    (r) => r.activity_id === a.id && r.attempt === a.attempt - 1,
  );
  const lockedItems =
    a.attempt > 1 &&
    previousReview?.decision === 'rejected' &&
    !a.manager_reopened
      ? a.items
          .filter((i) => !previousReview.rejected_items.includes(i.id))
          .map((i) => i.id)
      : [];
  const [responses, setResponses] = useState(() =>
    executionResponses(a.items, a.responses, lockedItems),
  );
  const [photos, setPhotos] = useState<ExecutionPhoto[]>([]);
  const [submissionId, setSubmissionId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [executionError, setExecutionError] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [draftRevision, setDraftRevision] = useState(a.revision);
  const dirty = useRef(false);
  const notification = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (executionError || submitted) {
      notification.current?.focus({ preventScroll: true });
      notification.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    }
  }, [executionError, submitted]);
  const [draft, setDraft] = useState<Draft>();
  const [sync, setSync] = useState('Confirmado pelo servidor');
  const [finding, setFinding] = useState(false);
  const [reject, setReject] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [image, setImage] = useState<{ url: string; label: string } | null>(
    null,
  );
  const editable =
    a.assignee === user &&
    ['in_progress', 'correction'].includes(a.status) &&
    !submitted;
  const pending = a.status === 'pending' && a.assignee === user;
  const reviewing = a.status === 'review' && manager && a.assignee !== user;
  const makeDraft = (): Draft => ({
    revision: draftRevision,
    responses,
    photos,
    submissionId,
    attempt: a.attempt,
    savedAt: new Date().toISOString(),
  });
  const persist = async (d: Draft) => {
    await saveDraft(user, a.id, d);
    setDraft(d);
  };
  useEffect(() => {
    let active = true;
    getDraft(user, a.id)
      .then((d) => {
        if (!active) return;
        setDraft(d);
        if (
          d &&
          d.revision === a.revision &&
          (!d.attempt || d.attempt === a.attempt) &&
          editable
        ) {
          setResponses(executionResponses(a.items, d.responses, lockedItems));
          setPhotos(d.photos ?? []);
          setSubmissionId(d.submissionId ?? crypto.randomUUID());
          setSync('Rascunho recuperado');
          dirty.current = true;
        }
      })
      .catch(() => {
        if (active)
          setExecutionError(
            'Não foi possível recuperar o rascunho deste dispositivo.',
          );
      })
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
    };
  }, [user, a.id]);
  useEffect(() => {
    if (!dirty.current || !editable || !draftReady || sending) return;
    const t = setTimeout(() => {
      void persist(makeDraft()).catch(() =>
        setExecutionError(
          'Não foi possível salvar o rascunho. Mantenha esta vistoria aberta e tente novamente.',
        ),
      );
    }, 700);
    return () => clearTimeout(t);
  }, [
    responses,
    photos,
    editable,
    draftReady,
    sending,
    user,
    a.id,
    a.revision,
    draftRevision,
  ]);
  useEffect(() => {
    if (!dirty.current) {
      setResponses(executionResponses(a.items, a.responses, lockedItems));
      setDraftRevision(a.revision);
    }
  }, [a.revision, a.responses]);
  const update = (id: string, patch: Partial<Response>) => {
    const item = a.items.find((i) => i.id === id)!;
    setResponses((prev) => ({
      ...prev,
      [id]: updateItemResponse(item, prev[id], patch),
    }));
    dirty.current = true;
    setSync('Rascunho com alterações');
  };
  const mutate = (action: string, payload: Record<string, unknown> = {}) =>
    rpc('activity_action', {
      activity: a.id,
      expected_revision: a.revision,
      action,
      payload,
    });
  const evidence = data.evidence_files.filter((e) => e.activity_id === a.id);
  const reviews = data.checklist_review_cycles.filter(
    (r) => r.activity_id === a.id,
  );
  const findings = data.findings.filter((f) => f.activity_id === a.id);
  const order = data.service_orders.find((s) => s.activity_id === a.id);
  const model = data.checklist_template_versions.find(
    (t) => t.id === order?.template_id,
  );
  const booking = data.team_agenda.find((r) => r.id === order?.reservation_id);
  const futureOrder = Boolean(
    order &&
    ['checkin', 'checkout'].includes(order.order_type ?? '') &&
    dayKey(new Date(a.due_at)) > dayKey(new Date()),
  );
  const cycle = data.preparation_cycles.find((c) => c.id === a.cycle_id);
  const stay = data.stays.find((s) => s.id === cycle?.stay_id);
  return (
    <Modal
      title={`${unitName(a.unit_id)} · ${a.title}`}
      onClose={() => {
        if (sending) return;
        if (editable && dirty.current)
          void persist(makeDraft())
            .then(onClose)
            .catch(() =>
              setExecutionError(
                'Não foi possível salvar o rascunho. Tente novamente antes de fechar.',
              ),
            );
        else onClose();
      }}
      wide
      className="checklist-modal"
    >
      <div ref={notification} tabIndex={-1}>
        {executionError && (
          <p className="alert error" role="alert">
            {executionError} Suas respostas e fotos continuam aqui. Corrija o
            problema e tente enviar novamente.
          </p>
        )}
        {submitted && (
          <div className="alert success" role="status">
            <CheckCheck size={22} />
            <div>
              <strong>Enviado para aprovação com sucesso!</strong>
              <p>A vistoria foi recebida. Você já pode fechar esta tela.</p>
            </div>
          </div>
        )}
      </div>
      {order && manager && (
        <OrderManagement order={order} run={run} onChanged={onClose} />
      )}
      {order && (
        <p className="info-card">
          Ordem de serviço · {model?.name || 'Modelo'} · v
          {model?.version ?? '—'}
          {booking
            ? ` · ${booking.guests} hóspedes · ${booking.duration_nights} diária(s) · Saída ${booking.checkout}`
            : ''}
          {order.parent_order_id ? ' · Checkout vinculado ao check-in' : ''}.
          Esta execução usa a versão escolhida ao criar a ordem.
        </p>
      )}
      {order && (
        <OrderStayContext
          order={order}
          data={data}
          manager={manager}
          run={run}
        />
      )}
      <div className="detail-top">
        <Badge status={a.status} />
        <span>
          Tentativa {a.attempt} · Revisão {a.revision}
        </span>
        <span>{person(a.assignee)}</span>
      </div>
      <div className="info-card">
        <Users size={21} />
        <div>
          <strong>
            {order ? 'Ocupação da ordem' : 'Preparação'}: {a.occupancy} hóspedes
          </strong>
          <p>
            {cycle?.occupancy_source === 'base'
              ? 'Padrão-base da unidade'
              : 'Ocupação definida para este ciclo'}{' '}
            · Prazo {dateTime(a.due_at)}
          </p>
          {stay && (
            <p>
              Hospedagem: {stay.guest_name} · {stay.guests} hóspedes ·{' '}
              {stay.checkin} a {stay.checkout}
            </p>
          )}
        </div>
      </div>
      <div className="progress-line">
        <span>
          {progress({ ...a, responses })}% dos itens obrigatórios conferidos
        </span>
        <progress max={100} value={progress({ ...a, responses })} />
      </div>
      {draft && draft.revision !== a.revision && !submitted && (
        <div className="alert">
          <Save size={20} />
          <div>
            Rascunho local de {dateTime(draft.savedAt)}.
            {draft.revision !== a.revision
              ? ' A versão do servidor mudou. Compare antes de reaplicar; nada será sobrescrito automaticamente.'
              : ''}
            <details>
              <summary>Comparar com a conferência no servidor</summary>
              <ul>
                {a.items.map((i) => (
                  <li key={i.id}>
                    {i.title}:{' '}
                    {a.responses[i.id]?.confirmed ? 'checkado' : 'pendente'}
                    {i.mode === 'count'
                      ? ` · quantidade ${a.responses[i.id]?.found ?? 'não informada'}`
                      : ''}
                  </li>
                ))}
              </ul>
            </details>
            <div className="button-row">
              <button
                className="text-button"
                disabled={
                  Boolean(draft.attempt && draft.attempt !== a.attempt) ||
                  !editable
                }
                onClick={() => {
                  if (!dirty.current)
                    setResponses(
                      executionResponses(a.items, draft.responses, lockedItems),
                    );
                  if (!dirty.current) setPhotos(draft.photos ?? []);
                  setDraftRevision(a.revision);
                  setSubmissionId(draft.submissionId ?? crypto.randomUUID());
                  dirty.current = true;
                  setSync('Rascunho recuperado; aguardando envio');
                }}
              >
                Recuperar rascunho nesta revisão
              </button>
              <button
                className="text-button"
                onClick={() =>
                  void removeDraft(user, a.id).then(() => setDraft(undefined))
                }
              >
                Descartar rascunho
              </button>
            </div>
          </div>
        </div>
      )}
      {reviews
        .filter((r) => r.decision === 'rejected')
        .map((r) => (
          <div className="alert" key={r.id}>
            <AlertTriangle size={18} />
            <div>
              <strong>Correção da tentativa {r.attempt}</strong>
              <p>{r.reason}</p>
            </div>
          </div>
        ))}
      {pending && (
        <button
          className="button primary full"
          disabled={busy || futureOrder}
          onClick={() => void run(() => mutate('start'))}
        >
          <Sparkles size={18} />
          Iniciar{' '}
          {order
            ? 'ordem de serviço'
            : a.kind === 'inspection'
              ? 'vistoria'
              : 'arrumação'}
        </button>
      )}
      {pending && futureOrder && (
        <p className="info-card">
          Esta ordem está programada para {dateTime(a.due_at)}. A execução
          estará disponível no dia previsto.
        </p>
      )}
      {[...new Set(a.items.map((i) => i.room))].map((room) => (
        <section className="room-section" key={room}>
          <h3>
            <House size={18} />
            {room}
          </h3>
          {a.items
            .filter((i) => i.room === room)
            .map((i) => {
              const r = itemResponse(i, responses[i.id]);
              const lockedItem =
                lockedItems.includes(i.id) || busy || sending || !draftReady;
              const Extras = i.mode === 'count' ? 'details' : 'div';
              return (
                <div
                  className={`checklist-item ${i.mode === 'count' ? 'count-inline' : ''}`}
                  key={i.id}
                >
                  <div className="checklist-item-title">
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={r.confirmed}
                        disabled={!editable || lockedItem}
                        onChange={(e) =>
                          update(i.id, { confirmed: e.target.checked })
                        }
                      />
                      <strong>{i.title}</strong>
                    </label>
                    {i.required && (
                      <span className="required">Obrigatório</span>
                    )}
                  </div>
                  {i.mode === 'count' && (
                    <>
                      {' '}
                      <div className="counter-row">
                        <span>
                          Esperado: <strong>{i.expected}</strong>
                        </span>
                        <label className="counter">
                          <button
                            aria-label={`Diminuir quantidade de ${i.title}`}
                            disabled={!editable || lockedItem}
                            onClick={() =>
                              update(i.id, {
                                found: Math.max(0, (r.found ?? 0) - 1),
                              })
                            }
                          >
                            −
                          </button>
                          <input
                            aria-label={`Quantidade encontrada de ${i.title}`}
                            type="number"
                            min={0}
                            disabled={!editable || lockedItem}
                            value={r.found ?? ''}
                            onChange={(e) =>
                              update(i.id, { found: Number(e.target.value) })
                            }
                          />
                          <button
                            aria-label={`Aumentar quantidade de ${i.title}`}
                            disabled={!editable || lockedItem}
                            onClick={() =>
                              update(i.id, { found: (r.found ?? 0) + 1 })
                            }
                          >
                            +
                          </button>
                        </label>
                        {r.found !== undefined && r.found !== i.expected && (
                          <span className="error-text quantity-warning">
                            Quantidade divergente
                          </span>
                        )}
                      </div>
                      <label className="field">
                        <span>Condição</span>
                        <select
                          disabled={!editable || lockedItem}
                          value={r.condition ?? 'ok'}
                          onChange={(e) =>
                            update(i.id, { condition: e.target.value })
                          }
                        >
                          {[
                            { value: 'ok', label: 'Conforme' },
                            { value: 'damaged', label: 'Danificado' },
                            {
                              value: 'divergent',
                              label: 'Quantidade divergente',
                            },
                          ].map((c) => (
                            <option
                              key={c.value}
                              value={c.value}
                              disabled={
                                c.value === 'divergent'
                                  ? r.found === i.expected
                                  : r.found !== i.expected
                              }
                            >
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <Extras className="item-extras">
                    {i.mode === 'count' && (
                      <summary>Observações e reposição</summary>
                    )}
                    {i.instructions && (
                      <p className="muted">{i.instructions}</p>
                    )}
                    {i.mode === 'technical' && (
                      <label className="field">
                        <span>Conferência técnica</span>
                        <select
                          disabled={!editable || lockedItem}
                          value={r.answer ?? 'ok'}
                          onChange={(e) =>
                            update(i.id, { answer: e.target.value })
                          }
                        >
                          <option value="ok">Conforme</option>
                          <option value="issue">Não conforme</option>
                          {i.allow_na && (
                            <option value="na">Não se aplica</option>
                          )}
                        </select>
                      </label>
                    )}
                    {i.mode === 'count' && (
                      <>
                        <details>
                          <summary>Movimentação de enxoval e reposição</summary>
                          <div className="two-cols">
                            {[
                              {
                                key: 'laundry',
                                label: 'Recolhido para lavanderia',
                              },
                              { key: 'damaged', label: 'Danificado' },
                              { key: 'missing', label: 'Não localizado' },
                              { key: 'replenished', label: 'Reposto' },
                            ].map((f) => (
                              <label className="field" key={f.key}>
                                <span>{f.label}</span>
                                <input
                                  type="number"
                                  min={0}
                                  disabled={!editable || lockedItem}
                                  value={
                                    (r[f.key as keyof Response] as number) ?? ''
                                  }
                                  onChange={(e) =>
                                    update(i.id, {
                                      [f.key]: Number(e.target.value),
                                    })
                                  }
                                />
                              </label>
                            ))}
                          </div>
                          <small>
                            Itens recolhidos para lavanderia não são tratados
                            como desaparecidos.
                          </small>
                        </details>
                      </>
                    )}
                    <label className="field">
                      <span>
                        Observação{' '}
                        {r.answer === 'issue' ||
                        r.condition === 'damaged' ||
                        (r.found !== undefined && r.found !== i.expected)
                          ? '(obrigatória para divergências)'
                          : '(opcional)'}
                      </span>
                      <textarea
                        disabled={!editable || lockedItem}
                        value={r.note ?? ''}
                        onChange={(e) => update(i.id, { note: e.target.value })}
                      />
                    </label>
                    <div className="button-row">
                      {i.reference_path && (
                        <button
                          className="button secondary"
                          onClick={() =>
                            void run(
                              async () =>
                                setImage({
                                  url: await signedImage(
                                    'references',
                                    i.reference_path!,
                                  ),
                                  label: `Referência · ${i.title}`,
                                }),
                              'Foto de referência aberta.',
                            )
                          }
                        >
                          <Image size={16} />
                          Ver referência
                        </button>
                      )}
                    </div>
                  </Extras>
                </div>
              );
            })}
        </section>
      ))}
      <section className="room-section">
        <h3>
          <AlertTriangle size={18} />
          Ocorrências
        </h3>
        {findings.map((f) => (
          <div className="finding" key={f.id}>
            <strong>{f.title}</strong>
            <p>{f.description}</p>
            <small>
              {f.resolved_at
                ? 'Resolvida'
                : f.blocking
                  ? 'Impede a liberação'
                  : 'Não impeditiva'}
            </small>
            {manager && !f.resolved_at && (
              <Form
                fields={[
                  { name: 'reason', label: 'Justificativa da resolução' },
                ]}
                submit="Resolver ocorrência"
                onSubmit={(v) =>
                  run(() =>
                    rpc('resolve_finding', { finding: f.id, reason: v.reason }),
                  )
                }
              />
            )}
          </div>
        ))}
        {!isDone(a) && (
          <button
            className="button secondary"
            onClick={() => setFinding(!finding)}
          >
            <Plus size={16} />
            Registrar ocorrência
          </button>
        )}
        {finding && (
          <Form
            fields={[
              { name: 'title', label: 'Título' },
              { name: 'description', label: 'Descrição', type: 'textarea' },
              {
                name: 'blocking',
                label: 'Impede a liberação?',
                options: [
                  { value: 'false', label: 'Não' },
                  { value: 'true', label: 'Sim' },
                ],
                value: 'false',
              },
            ]}
            onSubmit={async (v) => {
              if (
                await run(() =>
                  rpc('create_finding', {
                    activity: a.id,
                    payload: { ...v, blocking: v.blocking === 'true' },
                  }),
                )
              )
                setFinding(false);
            }}
          />
        )}
      </section>
      <ExecutionPhotos
        photos={photos}
        evidence={evidence}
        attempt={a.attempt}
        editable={editable && draftReady && !busy && !sending}
        onChange={(next) => {
          setPhotos(next);
          dirty.current = true;
          setSync('Rascunho com alterações');
        }}
        onError={setExecutionError}
        onView={async (e) => {
          try {
            setImage({
              url: await signedImage('evidence', e.path),
              label: 'Foto da vistoria',
            });
          } catch (error) {
            setExecutionError(
              error instanceof Error
                ? error.message
                : 'Não foi possível abrir a foto.',
            );
          }
        }}
      />
      {editable && (
        <div className="detail-actions">
          <small>{sync}</small>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy || sending || !draftReady}
              onClick={() =>
                void run(async () => {
                  await persist(makeDraft());
                  setSync('Rascunho salvo');
                }, 'Rascunho salvo.')
              }
            >
              <Save size={17} />
              Salvar Rascunho
            </button>
            <button
              className="button primary"
              disabled={busy || sending || !draftReady}
              onClick={async () => {
                setSending(true);
                setExecutionError('');
                const ok = await run(async () => {
                  try {
                    await sendExecution(makeDraft(), {
                      persist: async (d) => {
                        await persist(d);
                        setPhotos(d.photos ?? []);
                      },
                      upload: (photo) =>
                        uploadPhoto(
                          'activity',
                          a.id,
                          photo.file,
                          '__activity__',
                          photo.id,
                        ),
                      submit: (d) =>
                        rpc('submit_checklist', {
                          activity: a.id,
                          expected_revision: d.revision,
                          submission: d.submissionId,
                          responses: d.responses,
                        }),
                    });
                  } catch (error) {
                    setExecutionError(
                      error instanceof Error
                        ? error.message
                        : 'Não foi possível enviar a vistoria.',
                    );
                    throw error;
                  }
                }, 'Vistoria enviada para aprovação com sucesso.');
                if (ok) {
                  setSubmitted(true);
                  dirty.current = false;
                  setDraft(undefined);
                  void removeDraft(user, a.id).catch(() => {});
                } else {
                  setExecutionError(
                    (previous) =>
                      previous || 'Não foi possível confirmar o envio.',
                  );
                }
                setSending(false);
              }}
            >
              <Send size={17} />
              {sending ? 'Enviando…' : 'Enviar para aprovação'}
            </button>
          </div>
          <small>
            Respostas e até {MAX_EXECUTION_PHOTOS} fotos são enviadas juntas. Em
            caso de erro, você pode continuar de onde parou.
          </small>
        </div>
      )}
      {reviewing && (
        <div className="detail-actions">
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await mutate('approve');
                  onClose();
                }, 'Arrumação aprovada e unidade liberada.')
              }
            >
              <CheckCheck size={18} />
              Aprovar arrumação
            </button>
            <button
              className="button secondary"
              onClick={() => setReject(!reject)}
            >
              Solicitar correção
            </button>
          </div>
          {reject && (
            <>
              <p>Selecione os itens que precisam de correção:</p>
              {a.items.map((i) => (
                <label key={i.id} className="check-label">
                  <input
                    type="checkbox"
                    checked={rejected.includes(i.id)}
                    onChange={(e) =>
                      setRejected((prev) =>
                        e.target.checked
                          ? [...prev, i.id]
                          : prev.filter((x) => x !== i.id),
                      )
                    }
                  />
                  {i.room} · {i.title}
                </label>
              ))}
              <Form
                fields={[
                  {
                    name: 'reason',
                    label: 'Justificativa da correção',
                    type: 'textarea',
                  },
                ]}
                submit="Devolver para correção"
                onSubmit={async (v) => {
                  if (
                    await run(() => mutate('reject', { ...v, items: rejected }))
                  )
                    onClose();
                }}
              />
            </>
          )}
        </div>
      )}
      {manager && !isDone(a) && cycle?.reservation_id && (
        <p className="info-card">
          Para mudar a data do checkout, use Editar saída na Agenda da equipe. A
          vistoria e a limpeza serão movidas juntas.
        </p>
      )}
      {manager && !isDone(a) && !cycle?.reservation_id && (
        <details className="room-section" open={schedule}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setSchedule(!schedule);
            }}
          >
            Programação e responsabilidade
          </summary>
          <Form
            fields={[
              {
                name: 'assignee',
                label: 'Responsável',
                options: data.profiles
                  .filter((p) => p.active)
                  .map((p) => ({ value: p.id, label: p.name })),
                value: a.assignee,
              },
              {
                name: 'due_at',
                label: 'Prazo',
                type: 'datetime-local',
                value: dueDefault(),
              },
              {
                name: 'priority',
                label: 'Prioridade',
                options: [
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'Alta' },
                  { value: 'urgent', label: 'Urgente' },
                ],
                value: a.priority,
              },
              { name: 'reason', label: 'Justificativa' },
            ]}
            submit="Atualizar programação"
            onSubmit={(v) =>
              run(() =>
                mutate('schedule', {
                  ...v,
                  due_at: new Date(v.due_at).toISOString(),
                }),
              )
            }
          />
          <Form
            fields={[{ name: 'reason', label: 'Justificativa para cancelar' }]}
            submit="Cancelar atividade"
            onSubmit={async (v) => {
              if (await run(() => mutate('cancel', v))) onClose();
            }}
          />
        </details>
      )}
      <details className="room-section">
        <summary>Histórico de submissões e decisões ({reviews.length})</summary>
        {reviews.map((r) => (
          <div className="review-history" key={r.id}>
            <strong>
              Tentativa {r.attempt} ·{' '}
              {r.decision === 'approved'
                ? 'Aprovada'
                : r.decision === 'rejected'
                  ? 'Devolvida'
                  : 'Enviada'}
            </strong>
            <p>
              {dateTime(r.submitted_at)}
              {r.reviewer ? ` · Revisão de ${person(r.reviewer)}` : ''}
            </p>
            <p>{r.reason}</p>
            <details>
              <summary>Respostas preservadas</summary>
              <pre>{JSON.stringify(r.snapshot.responses, null, 2)}</pre>
            </details>
          </div>
        ))}
      </details>
      {image && (
        <div className="image-viewer" role="region" aria-label={image.label}>
          <div>
            <strong>{image.label}</strong>
            <button
              className="icon-button"
              aria-label="Fechar fotografia"
              onClick={() => setImage(null)}
            >
              <X size={20} />
            </button>
          </div>
          <img src={image.url} alt={image.label} />
          <small>Link privado com validade de 2 minutos.</small>
        </div>
      )}
    </Modal>
  );
}
