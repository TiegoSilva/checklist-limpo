import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Users,
  Moon,
  House,
  AlertTriangle,
  Save,
  Plus,
  Image,
  Send,
  CheckCheck,
  X,
  LockKeyhole,
} from 'lucide-react';
import { Modal, Form, type ModalFeedback } from '../components';
import OrderStayContext from './OrderStayContext';
import OrderManagement from './OrderManagement';
import ExecutionSummary from './ExecutionSummary';
import {
  executionResponses,
  executionIssue,
  itemResponse,
  updateItemResponse,
  sendExecution,
} from './execution';
import ExecutionPhotos from './ExecutionPhotos';
import PendingUploads from './PendingUploads';
import { isVideo } from '../lib/media';
import { describeError } from '../lib/errors';
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
  type UploadProgress,
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
  const [cancelledFiles, setCancelledFiles] = useState<string[]>([]);
  const [orphanPending, setOrphanPending] = useState(false);
  const [submissionId, setSubmissionId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [sending, setSending] = useState(false);
  const sendLock = useRef(false);
  const photoLock = useRef(false);
  const [updatingFiles, setUpdatingFiles] = useState(false);
  const [uploads, setUploads] = useState<Record<string, UploadProgress>>({});
  const [submitted, setSubmitted] = useState(false);
  const [executionError, setExecutionError] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [draftRevision, setDraftRevision] = useState(a.revision);
  const dirty = useRef(false);
  const [validation, setValidation] =
    useState<ReturnType<typeof executionIssue>>(null);
  const itemNodes = useRef(new Map<string, HTMLDivElement>());
  const [feedback, setFeedback] = useState<ModalFeedback | null>(null);
  const [draft, setDraft] = useState<Draft>();
  const [sync, setSync] = useState('Confirmado pelo servidor');
  const [finding, setFinding] = useState(false);
  const [reject, setReject] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [image, setImage] = useState<{
    url: string;
    label: string;
    video?: boolean;
  } | null>(null);
  const editable =
    a.assignee === user &&
    ['in_progress', 'correction'].includes(a.status) &&
    !submitted;
  const pending = a.status === 'pending' && a.assignee === user;
  const waitingToStart = a.status === 'pending';
  const [starting, setStarting] = useState(false);
  const reviewing = a.status === 'review' && manager;
  const makeDraft = (): Draft => ({
    revision: draftRevision,
    responses,
    photos,
    cancelledFiles,
    submissionId,
    attempt: a.attempt,
    savedAt: new Date().toISOString(),
  });
  const persist = async (d: Draft) => {
    await saveDraft(user, a.id, d);
    setDraft(d);
    setSync('Rascunho salvo automaticamente');
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
          setCancelledFiles(d.cancelledFiles ?? []);
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
    setValidation(null);
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
  const futureOrder = Boolean(
    order &&
    ['checkin', 'checkout'].includes(order.order_type ?? '') &&
    dayKey(new Date(a.due_at)) > dayKey(new Date()),
  );
  const cycle = data.preparation_cycles.find((c) => c.id === a.cycle_id);
  const stay = data.stays.find((s) => s.id === cycle?.stay_id);
  const booking = data.team_agenda.find((r) => r.id === order?.reservation_id);
  const arrival = booking?.checkin ?? stay?.checkin;
  const departure = booking?.checkout ?? stay?.checkout;
  const guests = booking?.guests ?? stay?.guests ?? a.occupancy;
  const nights =
    booking?.duration_nights ??
    (arrival && departure
      ? Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000)
      : null);

  const showSuccess = (message: string, terminal = false, title?: string) =>
    setFeedback({
      kind: 'success',
      title:
        title ?? (terminal ? 'Atividade enviada com sucesso!' : 'Tudo certo!'),
      message,
      actionLabel: terminal ? 'Concluir atividade' : 'Retomar vistoria',
      onAction: terminal ? onClose : () => setFeedback(null),
    });
  const runAction: Run = async (
    fn,
    success = 'Alteração salva com sucesso.',
  ) => {
    setFeedback(null);
    let failed = '';
    const ok = await run(async () => {
      try {
        await fn();
      } catch (error) {
        failed = describeError(error);
        setExecutionError(failed);
        throw error;
      }
    }, success);
    if (!ok)
      setExecutionError(
        (previous) =>
          failed ||
          previous ||
          'Não foi possível confirmar a ação. Tente novamente.',
      );
    else if (success) showSuccess(success);
    return ok;
  };
  return (
    <Modal
      title={`${unitName(a.unit_id)} · ${a.title}`}
      onClose={() => {
        if (sending || updatingFiles) return;
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
      className="checklist-modal execution-modal"
      feedback={
        executionError
          ? {
              kind: 'error',
              title: /DRAFT_SAVE|LOCAL_STORAGE/.test(executionError)
                ? 'Não foi possível salvar o rascunho'
                : /EVIDENCE|EXECUTION_FILE/.test(executionError)
                  ? 'Falha no envio da evidência'
                  : /CHECKLIST_SUBMIT/.test(executionError)
                    ? 'Checklist ainda não enviado'
                    : 'Não foi possível concluir a ação',
              message: `${executionError} Suas respostas e arquivos foram mantidos. Retome a vistoria para corrigir o problema e tentar novamente.`,
              actionLabel: 'Retomar vistoria',
              onAction: () => {
                setExecutionError('');
                setFeedback(null);
              },
            }
          : feedback
      }
    >
      <div
        className="execution-toolbar"
        aria-label="Informações fixas da vistoria"
      >
        <div className="stay-facts">
          <span>
            <Users size={17} />
            <strong>{guests}</strong> hóspedes
          </span>
          {nights !== null && (
            <span>
              <Moon size={17} />
              <strong>{nights}</strong> diária(s)
            </span>
          )}
        </div>
        <div className="execution-progress">
          <span>{progress({ ...a, responses })}% conferido</span>
          <progress max={100} value={progress({ ...a, responses })} />
        </div>
      </div>
      <div className="execution-body">
        <ExecutionSummary activity={a} data={data} person={person} compact />
        {order && (
          <OrderStayContext
            order={order}
            data={data}
            manager={manager}
            run={runAction}
            showSummary={false}
            onError={setExecutionError}
          />
        )}
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
                        executionResponses(
                          a.items,
                          draft.responses,
                          lockedItems,
                        ),
                      );
                    if (!dirty.current) {
                      setPhotos(draft.photos ?? []);
                      setCancelledFiles(draft.cancelledFiles ?? []);
                    }
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
        {pending && futureOrder && (
          <p className="info-card">
            Esta ordem está programada para {dateTime(a.due_at)}. A execução
            estará disponível no dia previsto.
          </p>
        )}
        <div
          className={`execution-start-boundary ${waitingToStart ? 'is-locked' : ''}`}
        >
          <div
            className="execution-checklist-content"
            inert={waitingToStart}
            aria-hidden={waitingToStart || undefined}
          >
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
                      lockedItems.includes(i.id) ||
                      busy ||
                      sending ||
                      !draftReady;
                    const problem =
                      r.condition === 'damaged' ||
                      r.condition === 'divergent' ||
                      r.answer === 'issue';
                    return (
                      <div
                        className={`checklist-item ${i.mode === 'count' ? 'count-inline' : ''}`}
                        key={i.id}
                        ref={(node) => {
                          if (node) itemNodes.current.set(i.id, node);
                          else itemNodes.current.delete(i.id);
                        }}
                        tabIndex={-1}
                        aria-invalid={validation?.itemId === i.id || undefined}
                      >
                        <div className="checklist-item-title">
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={r.confirmed}
                              disabled={!editable || sending || lockedItem}
                              onChange={(e) =>
                                update(i.id, { confirmed: e.target.checked })
                              }
                            />
                            <strong>{i.title}</strong>
                          </label>
                          {!i.required && (
                            <span className="required">Opcional</span>
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
                                  disabled={!editable || sending || lockedItem}
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
                                  disabled={!editable || sending || lockedItem}
                                  value={r.found ?? ''}
                                  onChange={(e) =>
                                    update(i.id, {
                                      found: Number(e.target.value),
                                    })
                                  }
                                />
                                <button
                                  aria-label={`Aumentar quantidade de ${i.title}`}
                                  disabled={!editable || sending || lockedItem}
                                  onClick={() =>
                                    update(i.id, {
                                      found: Math.min(9999, (r.found ?? 0) + 1),
                                    })
                                  }
                                >
                                  +
                                </button>
                              </label>
                              {r.found !== undefined &&
                                r.found !== i.expected && (
                                  <span className="error-text quantity-warning">
                                    Quantidade divergente
                                  </span>
                                )}
                            </div>
                          </>
                        )}
                        {i.mode === 'technical' && (
                          <label className="field">
                            <span>Conferência técnica</span>
                            <select
                              disabled={!editable || sending || lockedItem}
                              value={r.answer ?? 'ok'}
                              onChange={(e) =>
                                update(i.id, {
                                  answer: e.target.value,
                                })
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
                        {validation?.itemId === i.id && (
                          <p className="item-validation" role="alert">
                            {validation.message}
                          </p>
                        )}
                        <details
                          className="item-extras"
                          open={
                            problem || validation?.itemId === i.id
                              ? true
                              : undefined
                          }
                        >
                          <summary>
                            {i.mode === 'count'
                              ? r.condition === 'damaged'
                                ? 'Danificado · explicar'
                                : r.condition === 'divergent'
                                  ? 'Quantidade divergente · explicar'
                                  : 'Conforme · detalhes'
                              : problem
                                ? 'Descrever problema'
                                : 'Observações e detalhes'}
                          </summary>
                          {i.mode === 'count' && (
                            <>
                              <label className="field">
                                <span>Condição</span>
                                <select
                                  aria-label={`Condição de ${i.title}`}
                                  disabled={!editable || sending || lockedItem}
                                  value={r.condition ?? 'ok'}
                                  onChange={(e) =>
                                    update(i.id, {
                                      condition: e.target.value,
                                    })
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
                          {i.instructions && (
                            <p className="muted">{i.instructions}</p>
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
                              disabled={!editable || sending || lockedItem}
                              value={r.note ?? ''}
                              onChange={(e) =>
                                update(i.id, { note: e.target.value })
                              }
                            />
                          </label>
                          {i.mode === 'count' && (
                            <>
                              <details>
                                <summary>
                                  Movimentação de enxoval e reposição
                                </summary>
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
                                        disabled={
                                          !editable || sending || lockedItem
                                        }
                                        value={
                                          (r[
                                            f.key as keyof Response
                                          ] as number) ?? ''
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
                                  Itens recolhidos para lavanderia não são
                                  tratados como desaparecidos.
                                </small>
                              </details>
                            </>
                          )}
                          <div className="button-row">
                            {i.reference_path && (
                              <button
                                className="button secondary"
                                onClick={() =>
                                  void runAction(
                                    async () =>
                                      setImage({
                                        url: await signedImage(
                                          'references',
                                          i.reference_path!,
                                        ),
                                        label: `Referência · ${i.title}`,
                                      }),
                                    '',
                                  )
                                }
                              >
                                <Image size={16} />
                                Ver referência
                              </button>
                            )}
                          </div>
                        </details>
                      </div>
                    );
                  })}
              </section>
            ))}
            <details
              className="room-section execution-findings"
              open={findings.length > 0 || finding ? true : undefined}
            >
              <summary>
                <AlertTriangle size={18} /> Ocorrências{' '}
                {findings.length ? `(${findings.length})` : '(opcional)'}
              </summary>
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
                        runAction(() =>
                          rpc('resolve_finding', {
                            finding: f.id,
                            reason: v.reason,
                          }),
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
                    {
                      name: 'description',
                      label: 'Descrição',
                      type: 'textarea',
                    },
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
                      await runAction(() =>
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
            </details>
            <ExecutionPhotos
              uploads={uploads}
              photos={photos}
              evidence={evidence}
              attempt={a.attempt}
              editable={
                editable && draftReady && !busy && !sending && !updatingFiles
              }
              onChange={async (next) => {
                if (photoLock.current) return;
                photoLock.current = true;
                setUpdatingFiles(true);
                try {
                  setCancelledFiles((previous) => [
                    ...new Set([
                      ...previous,
                      ...photos
                        .filter((p) => !next.some((n) => n.id === p.id))
                        .map((p) => p.id),
                    ]),
                  ]);
                  setValidation(null);
                  setPhotos(next);
                  dirty.current = true;
                  setSync('Rascunho com alterações');
                } catch (e) {
                  setExecutionError(describeError(e));
                } finally {
                  photoLock.current = false;
                  setUpdatingFiles(false);
                }
              }}
              onError={setExecutionError}
              onView={async (e) => {
                try {
                  setImage({
                    url: await signedImage(
                      'evidence',
                      e.path,
                      isVideo(e.mime_type) ? 900 : 120,
                    ),
                    label: isVideo(e.mime_type)
                      ? 'Vídeo da vistoria'
                      : 'Foto da vistoria',
                    video: isVideo(e.mime_type),
                  });
                } catch (error) {
                  setExecutionError(
                    error instanceof Error
                      ? error.message
                      : 'Não foi possível abrir a evidência.',
                  );
                }
              }}
            />
            <PendingUploads
              kind="activity"
              resource={a.id}
              localIds={[...photos.map((p) => p.id), ...cancelledFiles]}
              active={editable && draftReady}
              busy={sending || updatingFiles}
              onError={setExecutionError}
              onPending={setOrphanPending}
            />
          </div>
          {waitingToStart && (
            <div className="execution-start-overlay">
              <div
                className="execution-start-card"
                role="region"
                aria-label="Iniciar checklist"
              >
                <LockKeyhole size={30} />
                <h3>Inicie a ordem para preencher o checklist</h3>
                <p>
                  {pending
                    ? futureOrder
                      ? `Disponível no dia ${dateTime(a.due_at)}.`
                      : 'Confira hóspedes e diárias e toque em iniciar. As respostas ficam liberadas após a confirmação.'
                    : `Aguardando ${person(a.assignee)} iniciar esta ordem.`}
                </p>
                {pending && (
                  <button
                    className="button primary"
                    disabled={busy || starting || futureOrder}
                    onClick={async () => {
                      setStarting(true);
                      try {
                        await runAction(() => mutate('start'), '');
                      } finally {
                        setStarting(false);
                      }
                    }}
                  >
                    <Sparkles size={18} />
                    {starting ? 'Iniciando…' : 'Iniciar ordem de serviço'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        {reviewing && reject && (
          <div className="review-correction" id={`review-correction-${a.id}`}>
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
                      await runAction(() =>
                        mutate('reject', { ...v, items: rejected }),
                      )
                    )
                      showSuccess(
                        'A atividade foi devolvida para correção.',
                        true,
                        'Correção solicitada',
                      );
                  }}
                />
              </>
            )}
          </div>
        )}
        {!order && manager && !isDone(a) && cycle?.reservation_id && (
          <p className="info-card">
            Para mudar a data do checkout, use Editar saída na Agenda da equipe.
            A vistoria e a limpeza serão movidas juntas.
          </p>
        )}
        {!order && manager && !isDone(a) && !cycle?.reservation_id && (
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
                runAction(() =>
                  mutate('schedule', {
                    ...v,
                    due_at: new Date(v.due_at).toISOString(),
                  }),
                )
              }
            />
            <Form
              fields={[
                { name: 'reason', label: 'Justificativa para cancelar' },
              ]}
              submit="Cancelar atividade"
              onSubmit={async (v) => {
                if (await runAction(() => mutate('cancel', v)))
                  showSuccess('Atividade cancelada com sucesso.', true);
              }}
            />
          </details>
        )}
        <details className="room-section">
          <summary>
            Histórico de submissões e decisões ({reviews.length})
          </summary>
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
        {order &&
          manager &&
          !sending &&
          !updatingFiles &&
          !photos.some((p) => !p.uploaded) && (
            <OrderManagement
              order={order}
              run={runAction}
              onChanged={(action) => {
                if (action === 'delete') onClose();
              }}
              onError={setExecutionError}
            />
          )}
      </div>
      {editable && (
        <div className="execution-next">
          <button
            className="button secondary"
            disabled={sending}
            onClick={() => {
              const pending = a.items.filter(
                (i) =>
                  i.required &&
                  !responses[i.id]?.confirmed &&
                  !lockedItems.includes(i.id),
              );
              const first =
                pending.find(
                  (i) =>
                    (itemNodes.current.get(i.id)?.getBoundingClientRect().top ??
                      0) > 150,
                ) ?? pending[0];
              if (first) {
                itemNodes.current
                  .get(first.id)
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                itemNodes.current.get(first.id)?.focus({ preventScroll: true });
              } else
                document
                  .querySelector('.execution-photos')
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
          >
            Próxima pendência
          </button>
        </div>
      )}
      <footer className="execution-footer" hidden={waitingToStart}>
        {validation && !validation.itemId && (
          <p className="item-validation" role="alert">
            {validation.message}
          </p>
        )}
        {editable && (
          <div className="detail-actions">
            <small>{sync}</small>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy || sending || updatingFiles || !draftReady}
                onClick={() =>
                  void runAction(async () => {
                    await persist(makeDraft());
                    setSync('Rascunho salvo');
                  }, '')
                }
              >
                <Save size={17} />
                Salvar Rascunho
              </button>
              <button
                className="button primary"
                disabled={
                  busy ||
                  sending ||
                  updatingFiles ||
                  orphanPending ||
                  !draftReady
                }
                onClick={async () => {
                  if (sendLock.current) return;
                  const issue = executionIssue(
                    a.items,
                    responses,
                    photos.length > 0 ||
                      evidence.some(
                        (e) => a.attempt === 1 || e.attempt === a.attempt,
                      ),
                    lockedItems,
                  );
                  setValidation(issue);
                  if (issue) {
                    if (issue.itemId) {
                      const node = itemNodes.current.get(issue.itemId);
                      node?.scrollIntoView({
                        block: 'center',
                        behavior: 'smooth',
                      });
                      node?.focus({ preventScroll: true });
                    }
                    return;
                  }
                  sendLock.current = true;
                  setSending(true);
                  setExecutionError('');
                  const ok = await runAction(async () => {
                    try {
                      await sendExecution(makeDraft(), {
                        prepare: async (d) => {
                          for (const file of d.cancelledFiles ?? [])
                            await rpc('cancel_evidence_upload', {
                              kind: 'activity',
                              resource: a.id,
                              file,
                            });
                          await rpc('expect_evidence_uploads', {
                            kind: 'activity',
                            resource: a.id,
                            files: (d.photos ?? []).map((p) => p.id),
                          });
                          setCancelledFiles([]);
                        },
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
                            (progress) =>
                              setUploads((previous) => ({
                                ...previous,
                                [photo.id]: progress,
                              })),
                          ),
                        submit: (d) =>
                          rpc('submit_checklist_with_evidence', {
                            activity: a.id,
                            expected_revision: d.revision,
                            submission: d.submissionId,
                            responses: d.responses,
                            files: (d.photos ?? []).map((p) => p.id),
                          }),
                      });
                    } catch (error) {
                      setExecutionError(describeError(error));
                      throw error;
                    }
                  }, 'Vistoria enviada para aprovação com sucesso.');
                  if (ok) {
                    setSubmitted(true);
                    showSuccess(
                      'A vistoria foi recebida e enviada para aprovação. Você pode concluir esta etapa.',
                      true,
                    );
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
                  sendLock.current = false;
                }}
              >
                <Send size={17} />
                {sending ? 'Enviando…' : 'Enviar para aprovação'}
              </button>
            </div>
          </div>
        )}
        {reviewing && (
          <div className="review-footer">
            <strong>
              {reject ? 'Solicitação de correção' : 'Revisão do checklist'}
            </strong>{' '}
            <div className="button-row">
              {!reject && (
                <>
                  <button
                    className="button primary"
                    disabled={busy || sending}
                    onClick={async () => {
                      setSending(true);
                      if (
                        await runAction(async () => {
                          await mutate('approve');
                        })
                      )
                        showSuccess(
                          'A revisão foi concluída e a ordem está concluída.',
                          true,
                          'Revisão concluída!',
                        );
                      setSending(false);
                    }}
                  >
                    <CheckCheck size={18} />
                    Concluir revisão
                  </button>
                </>
              )}
              <button
                className="button secondary"
                disabled={busy || sending}
                onClick={() => {
                  setReject(!reject);
                  requestAnimationFrame(() =>
                    document
                      .getElementById(`review-correction-${a.id}`)
                      ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                  );
                }}
              >
                {reject ? 'Cancelar correção' : 'Solicitar correção'}
              </button>
            </div>
          </div>
        )}
        {a.status === 'review' && !manager && (
          <p className="muted">Enviado. Aguardando revisão de um gestor.</p>
        )}
        {isDone(a) && (
          <button className="button secondary full" onClick={onClose}>
            Fechar
          </button>
        )}
      </footer>
      {image && (
        <div className="image-viewer" role="region" aria-label={image.label}>
          <div>
            <strong>{image.label}</strong>
            <button
              className="icon-button"
              aria-label="Fechar evidência"
              onClick={() => setImage(null)}
            >
              <X size={20} />
            </button>
          </div>
          {image.video ? (
            <video
              src={image.url}
              controls
              playsInline
              preload="metadata"
              aria-label={image.label}
            />
          ) : (
            <img src={image.url} alt={image.label} />
          )}
          {image.video && (
            <a
              className="button secondary"
              href={image.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir vídeo em outra janela
            </a>
          )}
          <small>Evidência privada, disponível por tempo limitado.</small>
        </div>
      )}
    </Modal>
  );
}
