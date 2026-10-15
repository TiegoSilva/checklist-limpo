import { useEffect, useState } from 'react';
import { Trash2, RotateCcw, Settings2 } from 'lucide-react';
import type { Data, Service } from '../domain';
import { rpc, type Run } from '../lib/client';
const statuses = [
  ['assigned', 'Pendente'],
  ['in_progress', 'Em execução'],
  ['review', 'Em aprovação'],
  ['approved', 'Aprovada'],
  ['rejected', 'Em correção'],
  ['cancelled', 'Cancelada'],
];
export default function OrderManagement({
  order,
  run,
  onChanged,
}: {
  order: Service;
  run: Run;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState(order.status),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setStatus(order.status);
    setConfirm(false);
  }, [order.id, order.revision, order.status]);
  const act = async (action: 'status' | 'delete') => {
    if (reason.trim().length < 5) {
      setError('Informe o motivo, com pelo menos 5 caracteres.');
      return;
    }
    setBusy(true);
    setError('');
    const ok = await run(
      async () => {
        try {
          return await rpc('manage_work_order', {
            order_id: order.id,
            expected_revision: order.revision,
            action,
            payload: { status, reason },
          });
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : 'Não foi possível atualizar a ordem.',
          );
          throw e;
        }
      },
      action === 'delete'
        ? 'Ordem excluída. O histórico foi preservado.'
        : 'Status da ordem atualizado.',
    );
    setBusy(false);
    if (ok) onChanged();
  };
  return (
    <details className="room-section order-management">
      <summary>
        <Settings2 size={17} />
        Gerenciar ordem de serviço
      </summary>
      <p className="muted">
        Alterações de status e exclusões ficam registradas no histórico.
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <label className="field">
        <span>Status da ordem</span>
        <select
          value={status}
          disabled={busy}
          onChange={(e) => setStatus(e.target.value)}
        >
          {statuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Motivo da alteração</span>
        <textarea
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={busy || status === order.status}
          onClick={() => void act('status')}
        >
          Atualizar status
        </button>
        <button
          className="button secondary danger-text"
          disabled={busy}
          onClick={() => setConfirm(!confirm)}
        >
          <Trash2 size={17} />
          Excluir ordem
        </button>
      </div>
      {confirm && (
        <div className="alert">
          <div>
            <strong>Excluir esta ordem?</strong>
            <p>
              {order.order_type === 'checkin'
                ? 'O checkout gerado com este check-in também será excluído. '
                : ''}
              A ordem sairá da operação. Respostas e fotos serão preservadas, e
              o gestor poderá restaurá-la.
            </p>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void act('delete')}
            >
              Confirmar exclusão
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
export function DeletedOrders({
  data,
  run,
  property,
}: {
  data: Data;
  run: Run;
  property: string;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const deleted = data.service_orders.filter(
    (s) =>
      s.deleted_at &&
      (!property ||
        data.units.find((u) => u.id === s.unit_id)?.property_id === property),
  );
  const batches = deleted.filter(
    (s) =>
      !s.deleted_batch_id ||
      !deleted.some(
        (other) =>
          other.id !== s.id &&
          other.deleted_batch_id === s.deleted_batch_id &&
          other.order_type === 'checkin',
      ) ||
      s.order_type === 'checkin',
  );
  if (!deleted.length) return null;
  return (
    <details className="room-section">
      <summary>Ordens excluídas ({deleted.length})</summary>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {batches.map((s) => (
        <article key={s.id} className="deleted-order-row">
          <div>
            <strong>{s.title}</strong>
            <p>
              {data.units.find((u) => u.id === s.unit_id)?.name}
              {s.order_type === 'checkin'
                ? ' · Restaura também o checkout excluído junto'
                : ''}
            </p>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              await run(async () => {
                try {
                  return await rpc('manage_work_order', {
                    order_id: s.id,
                    expected_revision: s.revision,
                    action: 'restore',
                    payload: { reason: 'Restauração solicitada pelo gestor' },
                  });
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : 'Não foi possível restaurar.',
                  );
                  throw e;
                }
              }, 'Ordem restaurada como pendente.');
              setBusy(false);
            }}
          >
            <RotateCcw size={16} />
            Restaurar
          </button>
        </article>
      ))}
    </details>
  );
}
