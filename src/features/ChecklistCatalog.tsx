import { ClipboardList, Eye, History, Pencil, Settings2 } from 'lucide-react';
import { Empty } from '../components';
import type { Data } from '../domain';
import { checklistLabel, latestTemplates, type Template } from './checklists';
export default function ChecklistCatalog({
  data,
  onEdit,
  onPreview,
  onCreate,
}: {
  data: Data;
  onEdit: (id: string) => void;
  onPreview: (id: string) => void;
  onCreate: () => void;
}) {
  const latest = latestTemplates(data.checklist_template_versions);
  const row = (t: Template, historical = false) => (
    <div key={t.id} className="template-row">
      <span className="section-icon">
        <ClipboardList size={21} />
      </span>
      <div>
        <strong>
          {data.units.find((u) => u.id === t.unit_id)?.name ?? 'Unidade'} ·{' '}
          {checklistLabel(t.kind)}
        </strong>
        <small>
          Versão {t.version} ·{' '}
          {t.items.filter((i) => i.mode === 'count').length} itens ·{' '}
          {t.items.filter((i) => i.mode !== 'count').length} tarefas
          {t.publication_source === 'migration'
            ? ' · Itens reconciliados automaticamente'
            : ''}
          {historical ? ' · Histórico' : ' · Atual'}
        </small>
      </div>
      <div className="button-row">
        <button className="button secondary" onClick={() => onPreview(t.id)}>
          <Eye size={16} />
          Ver prévia
        </button>
        {!historical && (
          <button className="button secondary" onClick={() => onEdit(t.id)}>
            <Pencil size={16} />
            Editar modelo
          </button>
        )}
      </div>
    </div>
  );
  const historical = data.checklist_template_versions
    .filter((t) => !latest.some((x) => x.id === t.id))
    .sort((a, b) => b.version - a.version);
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Modelos de checklist</h2>
          <p>
            Cada modelo pode ser usado em ordens de serviço. Itens com
            quantidade são compartilhados entre check-in e checkout.
          </p>
        </div>
        <Settings2 size={20} />
      </div>
      {latest.map((t) => row(t))}
      {!latest.length && (
        <Empty
          title="O padrão da sua hospitalidade"
          description="Cadastre os itens uma vez e mantenha check-in e checkout alinhados."
          action={onCreate}
          label="Criar modelo"
        />
      )}
      {historical.length > 0 && (
        <details className="template-history">
          <summary>
            <History size={17} />
            Versões anteriores ({historical.length})
          </summary>
          {historical.map((t) => row(t, true))}
        </details>
      )}
    </section>
  );
}
