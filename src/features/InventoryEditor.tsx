import { useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../components';
import type { Data } from '../domain';
import { rpc, type Run } from '../lib/client';
import QuantityStepper from './QuantityStepper';
export default function InventoryEditor({
  data,
  run,
  onClose,
}: {
  data: Data;
  run: Run;
  onClose: () => void;
}) {
  const [unit, setUnit] = useState(
    data.units.length === 1 ? data.units[0].id : '',
  );
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [room, setRoom] = useState('Geral');
  const [category, setCategory] = useState('permanent');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Cadastrar item do inventário" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError('');
          await run(async () => {
            try {
              await rpc('configure', {
                action: 'inventory',
                payload: {
                  unit_id: unit,
                  name: name.trim(),
                  expected: quantity,
                  room: room.trim() || 'Geral',
                  category,
                },
              });
              onClose();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : 'Não foi possível salvar.',
              );
              throw e;
            }
          });
          setSaving(false);
        }}
      >
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span>Unidade</span>
          <select
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
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
          <span>Nome do item</span>
          <input
            required
            value={name}
            placeholder="Ex.: copo de vidro"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="field">
          <span>Quantidade padrão</span>
          <QuantityStepper
            label={`Quantidade de ${name || 'item do inventário'}`}
            value={quantity}
            onChange={setQuantity}
          />
        </div>
        <details className="item-options">
          <summary>Ambiente e categoria</summary>
          <div className="item-options-body">
            <label className="field">
              <span>Ambiente</span>
              <input value={room} onChange={(e) => setRoom(e.target.value)} />
            </label>
            <label className="field">
              <span>Categoria</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="permanent">Patrimônio permanente</option>
                <option value="linen">Enxoval</option>
                <option value="consumable">Material consumível</option>
              </select>
            </label>
          </div>
        </details>
        <button
          className="button primary"
          disabled={saving || !unit || !name.trim()}
        >
          <Check size={17} />
          {saving ? 'Salvando…' : 'Salvar item'}
        </button>
      </form>
    </Modal>
  );
}
