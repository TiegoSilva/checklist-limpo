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
import { templateName, activeTemplates, duplicateItems } from './checklists';
import { inventoryDifferences } from './inventory';

export default function TemplateEditor({
  data,
  templateId,
  duplicateId,
  onClose,
  run,
}: {
  data: Data;
  templateId?: string;
  duplicateId?: string;
  onClose: () => void;
  run: Run;
}) {
  const existing = data.checklist_template_versions.find(
    (t) => t.id === templateId,
  );
  const latest = activeTemplates(data.checklist_template_versions);
  const duplicate = latest.find((t) => t.id === duplicateId);
  const [unit, setUnit] = useState(
    existing?.unit_id ??
      (!duplicate && data.units.length === 1 ? data.units[0].id : ''),
  );
  const kind = existing?.kind ?? 'cleaning';
  const baseId = existing?.id ?? null;
  const [sourceId, setSourceId] = useState(duplicate?.id ?? '');
  const [name, setName] = useState(
    existing
      ? templateName(existing)
      : duplicate
        ? `${templateName(duplicate)} (cópia)`
        : '',
  );
  const [items, setItems] = useState<Item[]>(
    existing?.items ?? (duplicate ? duplicateItems(duplicate.items) : []),
  );
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedUnit = data.units.find((u) => u.id === unit);
  const inventoryChanges = inventoryDifferences(data, unit, items);
  const changeSource = (id: string) => {
    const source = latest.find((t) => t.id === id);
    setSourceId(id);
    setName(source ? `${templateName(source)} (cópia)` : '');
    setItems(source ? duplicateItems(source.items) : []);
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
      const index = prev.findIndex((i) => i.id === id);
      const position = index + direction;
      if (index < 0 || position < 0 || position >= prev.length) return prev;
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
            inventory_item_id: i.id,
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
    if (!name.trim()) {
      setError('Dê um nome ao modelo.');
      return;
    }
    setSaving(true);
    await run(async () => {
      try {
        // Cada unidade mantém suas próprias fotos, inclusive após perder acesso à origem.
        const copied = new Map<string, string>();
        const publishedItems: Item[] = [];
        for (const item of items) {
          let path = item.reference_path;
          if (path && !path.startsWith(`${unit}/`)) {
            if (!supabase)
              throw new Error(
                'Configure o Supabase para copiar as referências.',
              );
            if (!copied.has(path)) {
              const destination = `${unit}/${crypto.randomUUID()}`;
              const { error } = await supabase.storage
                .from('references')
                .copy(path, destination);
              if (error) throw error;
              copied.set(path, destination);
            }
            path = copied.get(path)!;
          }
          publishedItems.push({ ...item, reference_path: path });
        }
        setItems(publishedItems);
        await rpc('save_named_checklist', {
          payload: {
            unit_id: unit,
            name: name.trim(),
            kind,
            base_template_id: baseId,
            source_template_id: sourceId || null,
            items: publishedItems.map((i) => ({
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
    }, 'Modelo salvo. O checkout será gerado a partir dos itens do check-in.');
    setSaving(false);
  };
  const options = (i: Item) => (
    <details className="item-options">
      <summary>Opções</summary>
      <div className="item-options-body">
        <label className="field">
          <span>Tipo de conferência</span>
          <select
            value={i.mode}
            onChange={(e) =>
              update(i.id, {
                mode: e.target.value as Item['mode'],
                ...(e.target.value === 'count'
                  ? { expected: i.expected ?? 1 }
                  : {}),
              })
            }
          >
            <option value="count">Item com quantidade</option>
            <option value="task">Tarefa — concluído ou pendente</option>
            <option value="technical">
              Conferência — conforme ou não conforme
            </option>
          </select>
        </label>
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
            disabled={items[0]?.id === i.id}
            onClick={() => move(i.id, -1)}
          >
            <ArrowUp size={15} />
            Mover para cima
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={items.at(-1)?.id === i.id}
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
        existing
          ? 'Editar modelo de checklist'
          : sourceId
            ? 'Duplicar modelo de checklist'
            : 'Novo modelo de checklist'
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
        <ChecklistPreview
          items={items}
          unit={selectedUnit}
          kind={kind}
          name={name}
        />
      ) : (
        <div className="form checklist-editor">
          {!existing && (
            <label className="field">
              <span>Começar a partir de</span>
              <select
                value={sourceId}
                disabled={saving}
                onChange={(e) => changeSource(e.target.value)}
              >
                <option value="">Modelo em branco</option>
                {latest.map((t) => (
                  <option key={t.id} value={t.id}>
                    {templateName(t)} ·{' '}
                    {data.units.find((u) => u.id === t.unit_id)?.name}
                  </option>
                ))}
              </select>
              <small>
                Duplique os itens, tarefas e referências de um modelo existente.
              </small>
            </label>
          )}
          <div className="two-cols">
            <label className="field">
              <span>{sourceId ? 'Unidade de destino' : 'Unidade'}</span>
              <select
                value={unit}
                disabled={Boolean(existing) || saving}
                onChange={(e) => {
                  setUnit(e.target.value);
                  setError('');
                }}
              >
                <option value="">Selecione</option>
                {data.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {data.properties.find((p) => p.id === u.property_id)?.name}{' '}
                    · {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Nome do modelo</span>
              <input
                value={name}
                required
                maxLength={100}
                disabled={saving}
                placeholder="Ex.: Preparação completa do apartamento"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            {baseId
              ? 'Salvar alterações publica uma nova versão.'
              : 'O primeiro salvamento publica o checklist.'}{' '}
            As atividades já criadas e suas respostas permanecem preservadas.
          </p>
          <section className="editor-section">
            {inventoryChanges.length > 0 && (
              <details className="wizard-options">
                <summary>
                  {inventoryChanges.length} itens para comparar com o inventário
                </summary>
                <p className="muted">
                  A revisão só atualiza este rascunho. Modelos publicados e
                  ordens existentes permanecem preservados; regras por hóspede
                  são mantidas.
                </p>
                {inventoryChanges.map(({ item, current }) => (
                  <div className="inventory-comparison" key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {item.room} · modelo: {item.expected ?? 0} · inventário:{' '}
                        {current.expected}
                        {item.quantity_per_guest !== undefined
                          ? ' · regra por hóspede mantida'
                          : ''}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={saving}
                      onClick={() =>
                        update(item.id, {
                          inventory_item_id: current.id,
                          title: current.name,
                          room: current.room,
                          ...(item.quantity_per_guest === undefined
                            ? { expected: current.expected }
                            : {}),
                        })
                      }
                    >
                      Usar referência atual
                    </button>
                  </div>
                ))}
              </details>
            )}
            <div className="editor-section-heading">
              <div>
                <h3>Itens do checklist</h3>
                <p>
                  Adicione todos os itens nesta lista. Em Opções, escolha
                  quantidade, tarefa ou conferência. O checkout reutiliza os
                  itens com quantidade.
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
            {items.map((i, index) => (
              <div className="compact-item" key={i.id}>
                <input
                  aria-label={`Nome do item ${index + 1}`}
                  value={i.title}
                  placeholder="Nome do item"
                  onChange={(e) => update(i.id, { title: e.target.value })}
                />
                {i.mode === 'count' ? (
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
                ) : (
                  <span className="compact-item-type">
                    {i.mode === 'task' ? 'Tarefa' : 'Conferência'}
                  </span>
                )}
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
            {!items.length && (
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
        </div>
      )}
      <div className="editor-save">
        <button
          type="button"
          className="button primary"
          disabled={
            !unit || !name.trim() || !items.length || uploading || saving
          }
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Check size={17} />
          )}
          {existing
            ? 'Salvar alterações'
            : sourceId
              ? 'Criar cópia'
              : 'Criar modelo'}
        </button>
      </div>
    </Modal>
  );
}
