import { useState, useEffect } from 'react';
import {
  Users,
  Sparkles,
  House,
  AlertTriangle,
  Save,
  Plus,
  Camera,
  Image,
  Send,
  CheckCheck,
  X,
} from 'lucide-react';
import { Modal, Form, Badge } from '../components';
import OrderStayContext from './OrderStayContext';
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
  uploadEvidence,
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
  const [responses, setResponses] = useState(a.responses);
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
    a.assignee === user && ['in_progress', 'correction'].includes(a.status);
  const pending = a.status === 'pending' && a.assignee === user;
  const reviewing = a.status === 'review' && manager && a.assignee !== user;
  useEffect(() => {
    getDraft(user, a.id).then(setDraft).catch(console.error);
  }, [user, a.id]);
  useEffect(() => {
    if (sync === 'Confirmado pelo servidor' || !editable) return;
    const t = setTimeout(() => {
      const d = {
        revision: a.revision,
        responses,
        savedAt: new Date().toISOString(),
      };
      void saveDraft(user, a.id, d)
        .then(() => setDraft(d))
        .catch(console.error);
    }, 700);
    return () => clearTimeout(t);
  }, [responses, sync, editable, user, a.id, a.revision]);
  useEffect(() => {
    if (sync === 'Confirmado pelo servidor') setResponses(a.responses);
  }, [a.revision, a.responses, sync]);
  const update = (id: string, patch: Partial<Response>) => {
    setResponses((prev) => ({
      ...prev,
      [id]: { ...prev[id], confirmed: false, ...patch },
    }));
    setSync('Alterações ainda não enviadas');
  };
  const mutate = (action: string, payload: Record<string, unknown> = {}) =>
    rpc('activity_action', {
      activity: a.id,
      expected_revision: a.revision,
      action,
      payload,
    });
  const save = async () => {
    const ok = await run(async () => {
      await mutate('save', { responses });
      await removeDraft(user, a.id);
      setDraft(undefined);
      setSync('Confirmado pelo servidor');
    });
    return ok;
  };
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
      onClose={onClose}
      wide
      className="checklist-modal"
    >
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
      {draft && (
        <div className="alert">
          <Save size={20} />
          <div>
            Rascunho local de {dateTime(draft.savedAt)}.
            {draft.revision !== a.revision
              ? ' A versão do servidor mudou. Compare antes de reaplicar; nada será sobrescrito automaticamente.'
              : ''}
            <div className="button-row">
              <button
                className="text-button"
                disabled={draft.revision !== a.revision || !editable}
                onClick={() => {
                  setResponses(draft.responses);
                  setSync('Rascunho recuperado; aguardando envio');
                }}
              >
                Recuperar rascunho
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
              const r = responses[i.id] ?? { confirmed: false };
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
                        disabled={!editable}
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
                            disabled={!editable}
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
                            disabled={!editable}
                            value={r.found ?? ''}
                            onChange={(e) =>
                              update(i.id, { found: Number(e.target.value) })
                            }
                          />
                          <button
                            aria-label={`Aumentar quantidade de ${i.title}`}
                            disabled={!editable}
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
                          disabled={!editable}
                          value={r.condition ?? ''}
                          onChange={(e) =>
                            update(i.id, { condition: e.target.value })
                          }
                        >
                          <option value="">Selecione</option>
                          {[
                            { value: 'ok', label: 'Conforme' },
                            {
                              value: 'divergent',
                              label: 'Quantidade divergente',
                            },
                            { value: 'damaged', label: 'Danificado' },
                            { value: 'broken', label: 'Quebrado' },
                            { value: 'missing', label: 'Não localizado' },
                            { value: 'moved', label: 'Deslocado de ambiente' },
                          ].map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <Extras className="item-extras">
                    {i.mode === 'count' && (
                      <summary>
                        Fotos, observações e reposição
                        {i.evidence_required ? ' · Foto obrigatória' : ''}
                      </summary>
                    )}
                    {i.instructions && (
                      <p className="muted">{i.instructions}</p>
                    )}
                    {i.mode === 'technical' && (
                      <label className="field">
                        <span>Conferência técnica</span>
                        <select
                          disabled={!editable}
                          value={r.answer ?? ''}
                          onChange={(e) =>
                            update(i.id, { answer: e.target.value })
                          }
                        >
                          <option value="">Selecione uma resposta</option>
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
                                  disabled={!editable}
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
                        (r.found !== undefined && r.found !== i.expected)
                          ? '(obrigatória para divergências)'
                          : '(opcional)'}
                      </span>
                      <textarea
                        disabled={!editable}
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
                      {editable && (
                        <label className="button secondary file-button">
                          <Camera size={16} />
                          {i.evidence_required
                            ? 'Anexar foto obrigatória'
                            : 'Anexar foto'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            capture="environment"
                            disabled={busy}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file)
                                await run(
                                  () => uploadEvidence(a.id, i.id, file),
                                  'Foto recebida pelo servidor.',
                                );
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                      {evidence
                        .filter((e) => e.item_id === i.id)
                        .map((e, index) => (
                          <button
                            className="button secondary"
                            key={e.id}
                            onClick={() =>
                              void run(
                                async () =>
                                  setImage({
                                    url: await signedImage('evidence', e.path),
                                    label: `Execução · ${i.title} · ${dateTime(e.received_at)}`,
                                  }),
                                'Foto de execução aberta.',
                              )
                            }
                          >
                            <Image size={15} />
                            Foto {index + 1}
                          </button>
                        ))}
                    </div>
                    {i.evidence_required &&
                      !evidence.some((e) => e.item_id === i.id) && (
                        <small className="muted">
                          Fotografia pendente. A conclusão ficará bloqueada.
                        </small>
                      )}
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
      {editable && (
        <div className="detail-actions">
          <small>{sync}</small>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const d = {
                    revision: a.revision,
                    responses,
                    savedAt: new Date().toISOString(),
                  };
                  await saveDraft(user, a.id, d);
                  setDraft(d);
                  setSync('Salvo somente neste dispositivo');
                }, 'Rascunho local salvo. Ainda não enviado.')
              }
            >
              <Save size={17} />
              Salvar no dispositivo
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void save()}
            >
              <Save size={17} />
              Enviar progresso
            </button>
            <button
              className="button primary"
              disabled={busy || sync !== 'Confirmado pelo servidor'}
              onClick={() =>
                void run(
                  async () => {
                    await mutate('submit');
                    onClose();
                  },
                  !order && a.kind === 'inspection'
                    ? 'Vistoria concluída.'
                    : 'Enviado para aprovação.',
                )
              }
            >
              <Send size={17} />
              {!order && a.kind === 'inspection'
                ? 'Concluir vistoria'
                : 'Enviar para aprovação'}
            </button>
          </div>
          <small>
            Após alterar os itens, envie o progresso antes de finalizar.
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
