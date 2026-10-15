import { useState } from 'react';
import { Camera, Image } from 'lucide-react';
import { Form, Modal } from './components';
import {
  dateTime,
  dayKey,
  statusLabels,
  type Data,
  type Service,
} from './domain';
import { rpc, signedImage, uploadPhoto } from './lib/client';
import OrderStayContext from './features/OrderStayContext';
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
  const [image, setImage] = useState<string>();
  const photos = data.service_evidence.filter((e) => e.service_id === s.id);
  const stay = data.team_agenda.find((r) => r.id === s.reservation_id);
  const future =
    ['checkin', 'checkout'].includes(s.order_type ?? '') &&
    dayKey(new Date(s.due_at)) > dayKey(new Date());
  return (
    <Modal title={s.title} onClose={onClose} wide>
      <div className="detail-top">
        <span className={`badge status-${s.status}`}>
          {statusLabels[s.status]}
        </span>
        <span>{dateTime(s.due_at)}</span>
        {s.blocking && <span className="error-text">Impede a liberação</span>}
      </div>
      <p className="modal-description">{s.description}</p>
      <OrderStayContext order={s} data={data} manager={manager} run={run} />
      {future && (
        <p className="info-card">
          Esta ordem estará disponível para execução no dia {dateTime(s.due_at)}
          .
        </p>
      )}
      <p className="info-card">
        Tarefa simples
        {s.parent_order_id ? ' · Checkout vinculado à ordem de check-in' : ''}
        {stay
          ? ` · ${stay.guests} hóspedes · ${stay.duration_nights} diária(s) · Saída ${stay.checkout}`
          : ''}
      </p>
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
                  setImage(await signedImage('service-evidence', p.path)),
                'Fotografia aberta.',
              )
            }
          >
            <Image size={16} />
            Foto {i + 1} · {dateTime(p.received_at)}
          </button>
        ))}
      </div>
      {image && (
        <div className="image-viewer">
          <img src={image} alt="Evidência da ordem de serviço" />
        </div>
      )}
      {s.assignee === user && s.status === 'in_progress' && (
        <label className="button secondary file-button">
          <Camera size={17} />
          Anexar evidência fotográfica
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f)
                await run(
                  () => uploadPhoto('service', s.id, f),
                  'Foto recebida e verificada pelo servidor.',
                );
              e.target.value = '';
            }}
          />
        </label>
      )}
      <Form
        fields={[
          {
            name: 'action',
            label: 'Próxima ação',
            options: [
              ...(s.assignee === user && !future
                ? ['assigned', 'rejected'].includes(s.status)
                  ? [{ value: 'start', label: 'Iniciar execução' }]
                  : s.status === 'in_progress'
                    ? [{ value: 'submit', label: 'Enviar para revisão' }]
                    : []
                : []),
              ...(manager && s.assignee !== user && s.status === 'review'
                ? [
                    { value: 'approve', label: 'Aprovar conclusão' },
                    { value: 'reject', label: 'Solicitar correção' },
                  ]
                : []),
            ],
          },
          {
            name: 'note',
            label: 'Descrição do serviço realizado',
            type: 'textarea',
            required: false,
          },
          {
            name: 'reason',
            label: 'Justificativa da correção',
            type: 'textarea',
            required: false,
          },
        ]}
        onSubmit={async (v) => {
          if (
            await run(() =>
              rpc('service_action', {
                action: v.action,
                payload: { ...v, id: s.id, revision: s.revision },
              }),
            )
          )
            onClose();
        }}
      />
    </Modal>
  );
}
