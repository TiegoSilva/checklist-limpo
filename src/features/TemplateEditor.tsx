import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  Image,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import { Modal } from '../components';
import { type Data, type Item } from '../domain';
import { supabase, rpc, type Run } from '../lib/client';
import QuantityStepper from './QuantityStepper';
import { ChecklistPreview } from './ChecklistPreview';
import { checklistLabel, activeTemplates } from './checklists';

export default function TemplateEditor({
  data,
  templateId,
  onClose,
  run,
}: {
  data: Data;
  templateId?: string;
  onClose: () => void;
  run: Run;
}) {
  const existing = data.checklist_template_versions.find(
    (t) => t.id === templateId,
  );
  const latest = activeTemplates(data.checklist_template_versions);
  const initialUnit =
    existing?.unit_id ?? (data.units.length === 1 ? data.units[0].id : '');
  const initialKind = existing?.kind ?? 'cleaning';
  const current = (unit: string, kind: string) =>
    latest.find((t) => t.unit_id === unit && t.kind === kind);
  const initial = current(initialUnit, initialKind);
  const [unit, setUnit] = useState(initialUnit);
  const [kind, setKind] = useState(initialKind);
  const [baseId, setBaseId] = useState(initial?.id ?? null);
  const [items, setItems] = useState<Item[]>(
    existing?.items ?? initial?.items ?? [],
  );
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedUnit = data.units.find((u) => u.id === unit);
  const counts = items.filter((i) => i.mode === 'count');
  const tasks = items.filter((i) => i.mode !== 'count');
  const changeSource = (nextUnit: string, nextKind: string) => {
    const next = current(nextUnit, nextKind);
    const paired = current(
      nextUnit,
      nextKind === 'cleaning' ? 'inspection' : 'cleaning',
    );
    setUnit(nextUnit);
    setKind(nextKind);
    setBaseId(next?.id ?? null);
    setItems(
      next?.items ?? paired?.items.filter((i) => i.mode === 'count') ?? [],
    );
    setError('');
  };
  const add = (mode: Item['mode']) =>
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        room: 'Geral',
        title: '',
        mode,
        required: true,
        evidence_required: false,
        ...(mode === 'count' ? { expected: 1 } : {}),
      },
    ]);
  const update = (id: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const move = (id: string, direction: number) =>
    setItems((prev) => {
      const selected = prev.find((i) => i.id === id)!;
      const siblings = prev.filter(
        (i) => (i.mode === 'count') === (selected.mode === 'count'),
      );
      const siblingIndex = siblings.findIndex((i) => i.id === id);
      const next = siblings[siblingIndex + direction];
      if (!next) return prev;
      const index = prev.findIndex((i) => i.id === id);
      const position = prev.findIndex((i) => i.id === next.id);
      const result = [...prev];
      [result[index], result[position]] = [result[position], result[index]];
      return result;
    });
  const importInventory = () => {
    const inventory = data.inventory_items.filter((i) => i.unit_id === unit);
    setItems((prev) => {
      const names = new Set(
        prev
          .filter((i) => i.mode === 'count')
          .map(
            (i) =>
              `${i.room.trim().toLowerCase()}:${i.title.trim().toLowerCase()}`,
          ),
      );
      return [
        ...prev,
        ...inventory
          .filter(
            (i) =>
              !names.has(
                `${i.room.trim().toLowerCase()}:${i.name.trim().toLowerCase()}`,
              ),
          )
          .map((i) => ({
            id: i.id,
            room: i.room,
            title: i.name,
            mode: 'count' as const,
            required: true,
            evidence_required: false,
            expected: i.expected,
          })),
      ];
    });
  };
  const save = async () => {
    setError('');
    setSaving(true);
    await run(async () => {
      try {
        await rpc('save_checklist', {
          payload: {
            unit_id: unit,
            kind,
            base_template_id: baseId,
            items: items.map((i) => ({
              ...i,
              title: i.title.trim(),
              room: i.room.trim() || 'Geral',
            })),
          },
        });
        onClose();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Não foi possível salvar o checklist.',
        );
        throw e;
      }
    }, 'Checklist salvo. Os itens com quantidade foram atualizados no check-in e no checkout.');
    setSaving(false);
  };
  const options = (i: Item) => (
    <details className="item-options">
      <summary>Opções</summary>
      <div className="item-options-body">
        <label className="field">
          <span>Ambiente</span>
          <input
            value={i.room}
            list={`rooms-${i.id}`}
            onChange={(e) => update(i.id, { room: e.target.value })}
          />
          <datalist id={`rooms-${i.id}`}>
            {data.environments
              .filter((r) => r.unit_id === unit)
              .map((r) => (
                <option key={r.id} value={r.name} />
              ))}
          </datalist>
        </label>
        <label className="field">
          <span>Instruções (opcional)</span>
          <textarea
            value={i.instructions ?? ''}
            onChange={(e) => update(i.id, { instructions: e.target.value })}
          />
        </label>
        {i.mode === 'count' && (
          <>
            <label className="check-label">
              <input
                type="checkbox"
                checked={i.quantity_per_guest !== undefined}
                onChange={(e) =>
                  update(i.id, {
                    quantity_per_guest: e.target.checked ? 1 : undefined,
                  })
                }
              />
              Calcular quantidade por hóspede
            </label>
            {i.quantity_per_guest !== undefined && (
              <div className="field">
                <span>Unidades por hóspede</span>
                <QuantityStepper
                  label={`Unidades de ${i.title || 'item'} por hóspede`}
                  value={i.quantity_per_guest}
                  onChange={(n) => update(i.id, { quantity_per_guest: n })}
                />
                <small>
                  A prévia e a execução multiplicam esse valor pela ocupação.
                </small>
              </div>
            )}
          </>
        )}
        <div className="two-cols">
          <label className="field">
            <span>Mínimo de hóspedes</span>
            <input
              type="number"
              min={1}
              value={i.min_guests ?? 1}
              onChange={(e) =>
                update(i.id, { min_guests: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Máximo de hóspedes</span>
            <input
              type="number"
              min={1}
              value={i.max_guests ?? selectedUnit?.capacity ?? 99}
              onChange={(e) =>
                update(i.id, { max_guests: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={i.required}
            onChange={(e) => update(i.id, { required: e.target.checked })}
          />
          Conferência obrigatória
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={i.evidence_required}
            onChange={(e) =>
              update(i.id, { evidence_required: e.target.checked })
            }
          />
          Fotografia obrigatória
        </label>
        {i.mode === 'technical' && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={i.allow_na ?? false}
              onChange={(e) => update(i.id, { allow_na: e.target.checked })}
            />
            Permitir “Não se aplica”
          </label>
        )}
        <label className="button secondary file-button">
          <Image size={16} />
          {i.reference_path
            ? 'Substituir foto de referência'
            : 'Anexar foto de referência'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={!unit || uploading || saving}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !supabase) return;
              setUploading(true);
              setError('');
              await run(async () => {
                try {
                  if (
                    !['image/jpeg', 'image/png', 'image/webp'].includes(
                      file.type,
                    ) ||
                    file.size > 10 * 1024 * 1024
                  )
                    throw new Error(
                      'Use imagens JPG, PNG ou WebP de até 10 MB.',
                    );
                  const path = `${unit}/${crypto.randomUUID()}`;
                  const { error } = await supabase!.storage
                    .from('references')
                    .upload(path, file, { upsert: false });
                  if (error) throw error;
                  update(i.id, { reference_path: path });
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : 'Falha ao enviar a foto.',
                  );
                  throw e;
                }
              }, 'Foto recebida. Salve as alterações para publicar a referência.');
              setUploading(false);
            }}
          />
        </label>
        <div className="button-row">
          <button
            className="button secondary"
            type="button"
            disabled={
              items.filter(
                (x) => (x.mode === 'count') === (i.mode === 'count'),
              )[0]?.id === i.id
            }
            onClick={() => move(i.id, -1)}
          >
            <ArrowUp size={15} />
            Mover para cima
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={
              items
                .filter((x) => (x.mode === 'count') === (i.mode === 'count'))
                .at(-1)?.id === i.id
            }
            onClick={() => move(i.id, 1)}
          >
            <ArrowDown size={15} />
            Mover para baixo
          </button>
        </div>
      </div>
    </details>
  );
  return (
    <Modal
      title={
        existing ? 'Editar modelo de checklist' : 'Novo modelo de checklist'
      }
      onClose={onClose}
      wide
      className="checklist-modal"
    >
      <div className="editor-tabs">
        <button
          type="button"
          className={`button ${view === 'edit' ? 'primary' : 'secondary'}`}
          aria-pressed={view === 'edit'}
          onClick={() => setView('edit')}
        >
          Editar
        </button>
        <button
          type="button"
          className={`button ${view === 'preview' ? 'primary' : 'secondary'}`}
          aria-pressed={view === 'preview'}
          disabled={!items.length}
          onClick={() => setView('preview')}
        >
          <Eye size={17} />
          Ver prévia
        </button>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {view === 'preview' ? (
        <ChecklistPreview items={items} unit={selectedUnit} kind={kind} />
      ) : (
        <div className="form checklist-editor">
          <div className="two-cols">
            <label className="field">
              <span>Unidade</span>
              <select
                value={unit}
                disabled={Boolean(existing) || saving}
                onChange={(e) => changeSource(e.target.value, kind)}
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
              <span>Checklist</span>
              <select
                value={kind}
                disabled={Boolean(existing) || saving}
                onChange={(e) => changeSource(unit, e.target.value)}
              >
                <option value="cleaning">{checklistLabel('cleaning')}</option>
                <option value="inspection">
                  {checklistLabel('inspection')}
                </option>
              </select>
            </label>
          </div>
          <p className="muted">
            {baseId
              ? 'Salvar alterações publica uma nova versão.'
              : 'O primeiro salvamento publica o checklist.'}{' '}
            As atividades já criadas e suas respostas permanecem preservadas.
          </p>
          <section className="editor-section">
            <div className="editor-section-heading">
              <div>
                <h3>Itens e quantidades</h3>
                <p>
                  Cadastre uma vez. Os mesmos itens e padrões ficam disponíveis
                  no check-in e no checkout.
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={!unit}
                onClick={importInventory}
              >
                Importar inventário
              </button>
            </div>
            {counts.map((i, index) => (
              <div className="compact-item" key={i.id}>
                <input
                  aria-label={`Nome do item ${index + 1}`}
                  value={i.title}
                  placeholder="Nome do item"
                  onChange={(e) => update(i.id, { title: e.target.value })}
                />
                <div className="compact-quantity">
                  <QuantityStepper
                    label={`Quantidade de ${i.title || `item ${index + 1}`}`}
                    value={i.quantity_per_guest ?? i.expected ?? 0}
                    onChange={(n) =>
                      update(
                        i.id,
                        i.quantity_per_guest === undefined
                          ? { expected: n }
                          : { quantity_per_guest: n },
                      )
                    }
                  />
                  {i.quantity_per_guest !== undefined && (
                    <small>/hóspede</small>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-button danger-text"
                  aria-label={`Remover ${i.title || `item ${index + 1}`}`}
                  onClick={() =>
                    setItems((prev) => prev.filter((x) => x.id !== i.id))
                  }
                >
                  <Trash2 size={18} />
                </button>
                {options(i)}
              </div>
            ))}
            {!counts.length && (
              <p className="editor-empty">
                Adicione o nome de um item e escolha a quantidade.
              </p>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => add('count')}
            >
              <Plus size={17} />
              Adicionar item
            </button>
          </section>
          <section className="editor-section">
            <div className="editor-section-heading">
              <div>
                <h3>
                  {kind === 'cleaning'
                    ? 'Tarefas de limpeza e conferência'
                    : 'Conferências adicionais de checkout'}
                </h3>
                <p>Estas tarefas pertencem somente a este checklist.</p>
              </div>
            </div>
            {tasks.map((i) => (
              <fieldset className="simple-item" key={i.id}>
                <legend>Tarefa</legend>
                <div className="simple-item-main">
                  <label className="field">
                    <span>O que precisa ser feito?</span>
                    <input
                      value={i.title}
                      placeholder="Ex.: limpar o banheiro"
                      onChange={(e) => update(i.id, { title: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Resposta</span>
                    <select
                      value={i.mode}
                      onChange={(e) =>
                        update(i.id, {
                          mode: e.target.value as 'task' | 'technical',
                        })
                      }
                    >
                      <option value="task">Concluído / pendente</option>
                      <option value="technical">Conforme / não conforme</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="icon-button danger-text"
                    aria-label={`Remover tarefa ${i.title}`}
                    onClick={() =>
                      setItems((prev) => prev.filter((x) => x.id !== i.id))
                    }
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                {options(i)}
              </fieldset>
            ))}
            <button
              type="button"
              className="button secondary"
              onClick={() => add(kind === 'cleaning' ? 'task' : 'technical')}
            >
              <Plus size={17} />
              Adicionar tarefa
            </button>
          </section>
        </div>
      )}
      <div className="editor-save">
        <button
          type="button"
          className="button primary"
          disabled={!unit || !items.length || uploading || saving}
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Check size={17} />
          )}
          Salvar alterações
        </button>
      </div>
    </Modal>
  );
}
