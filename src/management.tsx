import { useState } from 'react';
import { Camera, Image, CheckCheck, Play, Send, X } from 'lucide-react';
import { Badge, Form, Modal, type ModalFeedback } from './components';
import { dateTime, dayKey, type Data, type Service } from './domain';
import { isVideo, MEDIA_ACCEPT } from './lib/media';
import { rpc, signedImage, uploadPhoto } from './lib/client';
import OrderStayContext, { serviceWindow } from './features/OrderStayContext';
import OrderManagement from './features/OrderManagement';
type Run = (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
export function MemberEditor({
  data,
  run,
  onClose,
}: {
  data: Data;
  run: Run;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<string[]>(['cleaner']);
  const [access, setAccess] = useState<string[]>([]);
  return (
    <Modal title="Equipe e permissões" onClose={onClose} wide>
      <p className="modal-description">
        Primeiro crie ou convide a conta individual no Supabase Auth. Depois
        atribua as funções e propriedades abaixo. Informar uma conta existente
        atualiza seus acessos.
      </p>
      <Form
        fields={[
          {
            name: 'org_id',
            label: 'Organização',
            options: data.organizations.map((o) => ({
              value: o.id,
              label: o.name,
            })),
            value: data.organizations[0]?.id,
          },
          { name: 'email', label: 'E-mail da conta', type: 'email' },
          { name: 'name', label: 'Nome completo' },
        ]}
        onSubmit={async (v) => {
          if (
            await run(() =>
              rpc('configure', {
                action: 'member',
                payload: { ...v, roles, properties: access },
              }),
            )
          )
            onClose();
        }}
      >
        <fieldset className="template-item">
          <legend>Funções</legend>
          {[
            { id: 'admin', label: 'Administrador' },
            { id: 'manager', label: 'Gestor' },
            { id: 'inspector', label: 'Vistoriador' },
            { id: 'cleaner', label: 'Colaborador de limpeza' },
          ].map((r) => (
            <label className="check-label" key={r.id}>
              <input
                type="checkbox"
                checked={roles.includes(r.id)}
                onChange={(e) =>
                  setRoles((prev) =>
                    e.target.checked
                      ? [...prev, r.id]
                      : prev.filter((x) => x !== r.id),
                  )
                }
              />
              {r.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="template-item">
          <legend>Propriedades autorizadas</legend>
          {data.properties.map((p) => (
            <label className="check-label" key={p.id}>
              <input
                type="checkbox"
                checked={access.includes(p.id)}
                onChange={(e) =>
                  setAccess((prev) =>
                    e.target.checked
                      ? [...prev, p.id]
                      : prev.filter((x) => x !== p.id),
                  )
                }
              />
              {p.name}
            </label>
          ))}
          {!data.properties.length && (
            <p className="muted">Cadastre os empreendimentos primeiro.</p>
          )}
          <small className="muted">
            Administradores acessam todas as propriedades da organização. As
            demais funções precisam de autorização explícita.
          </small>
        </fieldset>
      </Form>
      <details className="room-section">
        <summary>Ativar ou desativar colaborador</summary>
        <Form
          fields={[
            {
              name: 'organization',
              label: 'Organização',
              options: data.organizations.map((o) => ({
                value: o.id,
                label: o.name,
              })),
              value: data.organizations[0]?.id,
            },
            {
              name: 'person',
              label: 'Colaborador',
              options: data.profiles.map((p) => ({
                value: p.id,
                label: p.name,
              })),
            },
            {
              name: 'enabled',
              label: 'Situação',
              options: [
                { value: 'false', label: 'Desativado' },
                { value: 'true', label: 'Ativo' },
              ],
            },
            { name: 'reason', label: 'Justificativa' },
          ]}
          submit="Atualizar situação"
          onSubmit={(v) =>
            run(() =>
              rpc('set_member_active', { ...v, enabled: v.enabled === 'true' }),
            )
          }
        />
      </details>
    </Modal>
  );
}
export function ServiceDetail({
  service: s,
  data,
  user,
  manager,
  run,
  onClose,
}: {
  service: Service;
  data: Data;
  user: string;
  manager: boolean;
  run: Run;
  onClose: () => void;
}) {
  const [image, setImage] = useState<{ url: string; video: boolean }>();
  const [feedback, setFeedback] = useState<ModalFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(s.completion_note ?? '');
  const [reason, setReason] = useState('');
  const [reject, setReject] = useState(false);
  const act = async (action: string) => {
    if (action === 'submit' && note.trim().length < 5) {
      setFeedback({
        kind: 'error',
        title: 'Descreva o serviço realizado',
        message:
          'Informe pelo menos 5 caracteres. O preenchimento será mantido.',
        actionLabel: 'Retomar tarefa',
        onAction: () => setFeedback(null),
      });
      return;
    }
    if (action === 'reject' && reason.trim().length < 5) {
      setFeedback({
        kind: 'error',
        title: 'Justifique a correção',
        message: 'Informe pelo menos 5 caracteres.',
        actionLabel: 'Retomar revisão',
        onAction: () => setFeedback(null),
      });
      return;
    }
    setBusy(true);
    let message = '';
    try {
      const ok = await run(async () => {
        try {
          return await rpc('service_action', {
            action,
            payload: { id: s.id, revision: s.revision, note, reason },
          });
        } catch (e) {
          message =
            e instanceof Error
              ? e.message
              : 'Não foi possível concluir a ação.';
          throw e;
        }
      }, '');
      if (ok && action === 'start') return;
      setFeedback(
        ok
          ? {
              kind: 'success',
              title:
                action === 'approve'
                  ? 'Revisão concluída!'
                  : action === 'reject'
                    ? 'Correção solicitada'
                    : 'Enviado para aprovação!',
              message:
                action === 'approve'
                  ? 'A ordem foi concluída.'
                  : 'A atualização foi confirmada pelo servidor.',
              actionLabel: 'Concluir atividade',
              onAction: onClose,
            }
          : {
              kind: 'error',
              title: 'Não foi possível concluir',
              message:
                message || 'Tente novamente. O preenchimento foi mantido.',
              actionLabel: 'Retomar tarefa',
              onAction: () => setFeedback(null),
            },
      );
    } finally {
      setBusy(false);
    }
  };
  const executable =
    s.assignee === user &&
    ['assigned', 'rejected', 'in_progress'].includes(s.status);
  const reviewing = manager && s.status === 'review';
  const photos = data.service_evidence.filter((e) => e.service_id === s.id);
  const stay = data.team_agenda.find((r) => r.id === s.reservation_id);
  const future =
    ['checkin', 'checkout'].includes(s.order_type ?? '') &&
    dayKey(new Date(s.due_at)) > dayKey(new Date());
  return (
    <Modal
      title={s.title}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
      className="checklist-modal execution-modal"
      feedback={feedback}
    >
      {stay && (
        <div className="execution-toolbar">
          <div className="stay-facts">
            <span>
              <strong>{stay.guests}</strong> hóspedes
            </span>
            <span>
              <strong>{stay.duration_nights}</strong> diária(s)
            </span>
          </div>
        </div>
      )}
      <div className="execution-body">
        <div className="detail-top">
          <Badge status={s.status} />
          <span>
            {data.profiles.find((p) => p.id === s.assignee)?.name ??
              'Responsável'}
          </span>
          {s.blocking && <span className="error-text">Impede a liberação</span>}
        </div>
        <p className="execution-schedule">{serviceWindow(s)}</p>
        <details className="execution-more">
          <summary>Detalhes da tarefa e da estadia</summary>
          {s.description && (
            <p className="modal-description">{s.description}</p>
          )}
          {stay && (
            <p className="muted">
              Estadia:{' '}
              {new Date(`${stay.checkin}T12:00:00`).toLocaleDateString('pt-BR')}{' '}
              a{' '}
              {new Date(`${stay.checkout}T12:00:00`).toLocaleDateString(
                'pt-BR',
              )}
            </p>
          )}
          {s.order_type !== 'checkin' &&
            (s.checkin_order_id || s.parent_order_id) && (
              <p className="muted">
                Check-in de origem #
                {(s.checkin_order_id ?? s.parent_order_id)!.slice(0, 8)}
              </p>
            )}
        </details>
        <OrderStayContext
          order={s}
          data={data}
          manager={manager}
          run={run}
          showSummary={false}
        />
        {future && (
          <p className="info-card">
            Esta ordem estará disponível para execução no dia{' '}
            {dateTime(s.due_at)}.
          </p>
        )}
        {s.completion_note && (
          <div className="info-card">
            <p>
              <strong>Evidência textual:</strong> {s.completion_note}
            </p>
          </div>
        )}
        <div className="button-row">
          {photos.map((p, i) => (
            <button
              key={p.id}
              className="button secondary"
              onClick={() =>
                void run(
                  async () =>
                    setImage({
                      url: await signedImage(
                        'service-evidence',
                        p.path,
                        isVideo(p.mime_type) ? 900 : 120,
                      ),
                      video: isVideo(p.mime_type),
                    }),
                  '',
                )
              }
            >
              <Image size={16} />
              {isVideo(p.mime_type) ? 'Vídeo' : 'Foto'} {i + 1} ·{' '}
              {dateTime(p.received_at)}
            </button>
          ))}
        </div>
        {image && (
          <div className="image-viewer">
            <button
              className="button secondary"
              onClick={() => setImage(undefined)}
            >
              <X size={18} />
              Fechar fotografia
            </button>
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
            {image.video ? (
              <video src={image.url} controls playsInline preload="metadata" />
            ) : (
              <img src={image.url} alt="Evidência da ordem de serviço" />
            )}
          </div>
        )}
        {s.assignee === user && s.status === 'in_progress' && (
          <label className="button secondary file-button">
            <Camera size={17} />
            Adicionar foto ou vídeo
            <input
              type="file"
              accept={MEDIA_ACCEPT}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f)
                  await run(
                    () => uploadPhoto('service', s.id, f),
                    'Evidência recebida e verificada pelo servidor.',
                  );
                e.target.value = '';
              }}
            />
          </label>
        )}
        {executable && s.status === 'in_progress' && (
          <label className="field">
            <span>Serviço realizado</span>
            <textarea
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Descreva o que foi feito"
            />
          </label>
        )}
        {reviewing && reject && (
          <label className="field">
            <span>O que precisa ser corrigido?</span>
            <textarea
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void act('reject')}
            >
              Devolver para correção
            </button>
          </label>
        )}
        {manager && <OrderManagement order={s} run={run} onChanged={onClose} />}
      </div>
      <footer className="execution-footer">
        {executable &&
          !future &&
          (s.status === 'in_progress' ? (
            <button
              className="button primary full"
              disabled={busy}
              onClick={() => void act('submit')}
            >
              <Send size={18} />
              Enviar para aprovação
            </button>
          ) : (
            <button
              className="button primary full"
              disabled={busy}
              onClick={() => void act('start')}
            >
              <Play size={18} />
              Iniciar tarefa
            </button>
          ))}
        {reviewing && (
          <div className="review-footer">
            <strong>Revisão da tarefa</strong>
            <div className="button-row">
              {!reject && (
                <>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void act('approve')}
                  >
                    <CheckCheck size={18} />
                    Concluir revisão
                  </button>
                </>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setReject(!reject)}
              >
                {reject ? 'Cancelar correção' : 'Solicitar correção'}
              </button>
            </div>
          </div>
        )}
        {!reviewing && (!executable || future) && (
          <button className="button secondary full" onClick={onClose}>
            Fechar
          </button>
        )}
      </footer>
    </Modal>
  );
}
