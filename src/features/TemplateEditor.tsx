import { useState } from 'react';
import { Plus, Image, Check } from 'lucide-react';
import { Modal } from '../components';
import { type Data, type Item } from '../domain';
import { supabase, rpc, type Run } from '../lib/client';
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
  const [unit, setUnit] = useState(existing?.unit_id ?? '');
  const [kind, setKind] = useState(existing?.kind ?? 'cleaning');
  const [items, setItems] = useState<Item[]>(existing?.items ?? []);
  const [uploading, setUploading] = useState(false);
  const add = (mode: Item['mode'] = 'task') =>
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        room: '',
        title: '',
        mode,
        required: true,
        evidence_required: false,
        ...(mode === 'count' ? { expected: 0 } : {}),
      },
    ]);
  const update = (id: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <Modal
      title={
        existing
          ? `Nova versão a partir da v${existing.version}`
          : 'Configuração de checklist'
      }
      onClose={onClose}
      wide
    >
      <div className="form">
        <label className="field">
          <span>Unidade</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Selecione</option>
            {data.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tipo de checklist</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="inspection">Vistoria de checkout</option>
            <option value="cleaning">Limpeza, arrumação e conferência</option>
          </select>
        </label>
        <p className="muted">
          Publicar cria uma versão imutável. Atividades existentes mantêm seus
          itens e fotografias de referência.
        </p>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() => add(kind === 'inspection' ? 'count' : 'task')}
          >
            <Plus size={16} />
            Adicionar tarefa
          </button>
          <button
            className="button secondary"
            onClick={() => {
              const inv = data.inventory_items.filter(
                (i) => i.unit_id === unit,
              );
              setItems((prev) => [
                ...prev,
                ...inv.map((i) => ({
                  id: crypto.randomUUID(),
                  room: i.room,
                  title: i.name,
                  mode: 'count' as const,
                  required: true,
                  evidence_required: false,
                  expected: i.expected,
                })),
              ]);
            }}
          >
            Importar inventário
          </button>
        </div>
        {items.map((i, index) => (
          <fieldset className="template-item" key={i.id}>
            <legend>Item {index + 1}</legend>
            <div className="two-cols">
              <label className="field">
                <span>Ambiente</span>
                <input
                  value={i.room}
                  onChange={(e) => update(i.id, { room: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Tarefa ou item</span>
                <input
                  value={i.title}
                  onChange={(e) => update(i.id, { title: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>Tipo de resposta</span>
              <select
                value={i.mode}
                onChange={(e) =>
                  update(i.id, {
                    mode: e.target.value as Item['mode'],
                    ...(e.target.value === 'count'
                      ? { expected: i.expected ?? 0 }
                      : {}),
                  })
                }
              >
                <option value="task">Tarefa simples</option>
                <option value="technical">Conferência técnica</option>
                <option value="count">Contagem de inventário</option>
              </select>
            </label>
            <label className="field">
              <span>Instruções</span>
              <textarea
                value={i.instructions ?? ''}
                onChange={(e) => update(i.id, { instructions: e.target.value })}
              />
            </label>
            <div className="two-cols">
              <label className="field">
                <span>A partir de quantos hóspedes</span>
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
                <span>Até quantos hóspedes</span>
                <input
                  type="number"
                  min={1}
                  value={i.max_guests ?? 99}
                  onChange={(e) =>
                    update(i.id, { max_guests: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            {i.mode === 'count' && (
              <label className="field">
                <span>Quantidade por hóspede (opcional)</span>
                <input
                  type="number"
                  min={0}
                  value={i.quantity_per_guest ?? ''}
                  onChange={(e) =>
                    update(i.id, {
                      quantity_per_guest:
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
            )}
            {i.mode === 'count' && (
              <label className="field">
                <span>Quantidade esperada</span>
                <input
                  type="number"
                  min={0}
                  value={i.expected ?? 0}
                  onChange={(e) =>
                    update(i.id, { expected: Number(e.target.value) })
                  }
                />
              </label>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={i.required}
                onChange={(e) => update(i.id, { required: e.target.checked })}
              />
              Item obrigatório
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
              <Image size={17} />
              {i.reference_path
                ? 'Substituir referência na nova versão'
                : 'Anexar foto de referência'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!unit || uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !supabase) return;
                  setUploading(true);
                  await run(async () => {
                    if (file.size > 10 * 1024 * 1024)
                      throw new Error('Use imagens de até 10 MB.');
                    const path = `${unit}/${crypto.randomUUID()}`;
                    const { error } = await supabase!.storage
                      .from('references')
                      .upload(path, file, { upsert: false });
                    if (error) throw error;
                    update(i.id, { reference_path: path });
                  }, 'Referência enviada. Publique a versão para utilizá-la.');
                  setUploading(false);
                }}
              />
            </label>
            <div className="button-row">
              <button
                className="text-button"
                disabled={index === 0}
                onClick={() =>
                  setItems((prev) => {
                    const arr = [...prev];
                    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
                    return arr;
                  })
                }
              >
                Mover para cima
              </button>
              <button
                className="text-button danger-text"
                onClick={() =>
                  setItems((prev) => prev.filter((x) => x.id !== i.id))
                }
              >
                Remover
              </button>
            </div>
          </fieldset>
        ))}
        <button
          className="button primary"
          disabled={!unit || !items.length || uploading}
          onClick={() =>
            void run(async () => {
              await rpc('configure', {
                action: 'template',
                payload: { unit_id: unit, kind, items },
              });
              onClose();
            }, 'Nova versão publicada.')
          }
        >
          <Check size={17} />
          Publicar versão
        </button>
      </div>
    </Modal>
  );
}
