import { useState } from 'react';
import {
  ArchiveRestore,
  ClipboardList,
  Eye,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Empty, Modal } from '../components';
import type { Data } from '../domain';
import { rpc, type Run } from '../lib/client';
import { checklistLabel, latestTemplates, type Template } from './checklists';
export default function ChecklistCatalog({
  data,
  onEdit,
  onPreview,
  onCreate,
  run,
}: {
  data: Data;
  onEdit: (id: string) => void;
  onPreview: (id: string) => void;
  onCreate: () => void;
  run?: Run;
}) {
  const [removing, setRemoving] = useState<Template | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const all = latestTemplates(data.checklist_template_versions),
    latest = all.filter((t) => !t.archived_at),
    archived = all.filter((t) => t.archived_at);
  const historical = data.checklist_template_versions
    .filter((t) => !all.some((x) => x.id === t.id))
    .sort((a, b) => b.version - a.version);
  const change = async (t: Template, archived: boolean) => {
    if (!run) return;
    setError('');
    setBusy(true);
    try {
      const ok = await run(
        async () => {
          try {
            return await rpc('set_checklist_archived', {
              template: t.id,
              archived,
            });
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : 'Não foi possível atualizar o modelo.',
            );
            throw e;
          }
        },
        archived
          ? 'Modelo removido. O histórico foi preservado.'
          : 'Modelo restaurado.',
      );
      if (ok) setRemoving(null);
    } finally {
      setBusy(false);
    }
  };
  const row = (t: Template, historical = false) => (
    <article
      key={t.id}
      className={`model-card ${historical ? 'historical-model' : ''}`}
    >
      <div className="model-card-top">
        <span className="model-icon">
          <ClipboardList size={24} />
        </span>
        <span className="model-tag">
          {t.archived_at
            ? 'Removido'
            : t.kind === 'inspection'
              ? 'Checkout'
              : 'Check-in'}
        </span>
      </div>
      <div className="model-card-copy">
        <small>
          {
            data.properties.find(
              (p) =>
                p.id ===
                data.units.find((u) => u.id === t.unit_id)?.property_id,
            )?.name
          }
        </small>
        <h3>{data.units.find((u) => u.id === t.unit_id)?.name ?? 'Unidade'}</h3>
        <p>{checklistLabel(t.kind)}</p>
        <span className="model-meta">
          {t.items.filter((i) => i.mode === 'count').length} itens ·{' '}
          {t.items.filter((i) => i.mode !== 'count').length} tarefas · Versão{' '}
          {t.version}
        </span>
      </div>
      <div className="model-actions">
        <button className="button secondary" onClick={() => onPreview(t.id)}>
          <Eye size={17} />
          Ver prévia
        </button>
        {!historical && !t.archived_at && (
          <>
            <button
              className="icon-button"
              aria-label={`Editar modelo de ${data.units.find((u) => u.id === t.unit_id)?.name} · ${checklistLabel(t.kind)}`}
              title="Editar modelo"
              onClick={() => onEdit(t.id)}
            >
              <Pencil size={18} />
            </button>
            <button
              className="icon-button danger-text"
              aria-label={`Remover modelo de ${data.units.find((u) => u.id === t.unit_id)?.name} · ${checklistLabel(t.kind)}`}
              title="Remover modelo"
              disabled={!run || busy}
              onClick={() => {
                setError('');
                setRemoving(t);
              }}
            >
              <Trash2 size={18} />
            </button>
          </>
        )}
        {!historical && t.archived_at && (
          <button
            className="button secondary"
            disabled={!run || busy}
            onClick={() => void change(t, false)}
          >
            <ArchiveRestore size={17} />
            Restaurar
          </button>
        )}
      </div>
    </article>
  );
  return (
    <section className="panel model-catalog">
      <div className="catalog-heading">
        <div>
          <span className="eyebrow">Sua operação, do seu jeito</span>
          <h2>Modelos de checklist</h2>
          <p>Prepare uma vez. Use em cada nova ordem.</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={18} />
          Novo modelo
        </button>
      </div>
      <div className="model-grid">{latest.map((t) => row(t))}</div>
      {!latest.length && (
        <Empty
          title="Seu próximo checklist começa aqui"
          description="Adicione os itens e tarefas que a equipe precisa conferir."
          action={onCreate}
          label="Criar modelo"
        />
      )}
      {error && !removing && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {archived.length > 0 && (
        <details className="template-history">
          <summary>
            <ArchiveRestore size={17} />
            Modelos removidos ({archived.length})
          </summary>
          <p className="muted">
            Restaure um modelo para usá-lo em novas ordens.
          </p>
          <div className="model-grid">{archived.map((t) => row(t))}</div>
        </details>
      )}
      {historical.length > 0 && (
        <details className="template-history">
          <summary>
            <History size={17} />
            Versões anteriores ({historical.length})
          </summary>
          <div className="model-grid">
            {historical.map((t) => row(t, true))}
          </div>
        </details>
      )}
      {removing && (
        <Modal
          title="Remover modelo?"
          className="confirm-modal"
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <div className="remove-illustration">
            <Trash2 size={26} />
          </div>
          <h3>{checklistLabel(removing.kind)}</h3>
          <p className="modal-description">
            O modelo sai das novas ordens. Ordens já criadas, respostas e fotos
            continuam preservadas. Você pode restaurá-lo depois.
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <div className="confirmation-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              Manter modelo
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void change(removing, true)}
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Trash2 size={18} />
              )}
              Remover modelo
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
