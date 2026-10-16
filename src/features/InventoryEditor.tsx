import { useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../components';
import type { Data } from '../domain';
import { rpc, type Run } from '../lib/client';
import QuantityStepper from './QuantityStepper';
import { inventoryLocation, type InventoryItem } from './inventory';
export default function InventoryEditor({
  data,
  run,
  onClose,
  initialProperty = '',
  initialUnit = '',
  item,
}: {
  data: Data;
  run: Run;
  onClose: () => void;
  initialProperty?: string;
  initialUnit?: string;
  item?: InventoryItem;
}) {
  const location = inventoryLocation(
    data,
    item?.unit_id || initialUnit,
    initialProperty,
  );
  const [property, setProperty] = useState(location.property);
  const [unit, setUnit] = useState(location.unit);
  const [name, setName] = useState(item?.name ?? '');
  const [quantity, setQuantity] = useState(item?.expected ?? 1);
  const [room, setRoom] = useState(item?.room ?? 'Geral');
  const [category, setCategory] = useState(item?.category ?? 'permanent');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const units = data.units.filter((u) => u.property_id === property);
  const validUnit = units.some((u) => u.id === unit);
  const rooms = data.environments.filter((e) => e.unit_id === unit);
  const sourceOrg = item
    ? data.properties.find(
        (p) =>
          p.id === data.units.find((u) => u.id === item.unit_id)?.property_id,
      )?.org_id
    : undefined;
  const properties = data.properties.filter(
    (p) => !sourceOrg || p.org_id === sourceOrg,
  );
  return (
    <Modal
      title={
        item ? 'Editar item do inventário' : 'Cadastrar item do inventário'
      }
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className="form inventory-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving || !validUnit || !name.trim()) return;
          setSaving(true);
          setError('');
          const ok = await run(
            async () => {
              try {
                await rpc('save_inventory_item', {
                  payload: {
                    ...(item
                      ? { id: item.id, revision: item.revision ?? 0 }
                      : {}),
                    unit_id: unit,
                    name: name.trim(),
                    expected: quantity,
                    room: room.trim() || 'Geral',
                    category,
                  },
                });
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : 'Não foi possível salvar.',
                );
                throw e;
              }
            },
            item
              ? 'Item atualizado e vinculado à unidade.'
              : 'Item cadastrado e vinculado à unidade.',
          );
          setSaving(false);
          if (ok) onClose();
        }}
      >
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={saving} className="inventory-fields">
          <div className="inventory-location-fields">
            <label className="field">
              <span>Propriedade</span>
              <select
                required
                value={property}
                onChange={(e) => {
                  const next = inventoryLocation(data, '', e.target.value);
                  setProperty(e.target.value);
                  setUnit(e.target.value ? next.unit : '');
                  setRoom('Geral');
                }}
              >
                <option value="">Selecione a propriedade</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Unidade</span>
              <select
                required
                disabled={!property || saving}
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                  setRoom('Geral');
                }}
              >
                <option value="">
                  {property
                    ? 'Selecione a unidade'
                    : 'Escolha a propriedade primeiro'}
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {property && !units.length && (
            <p role="status" className="inventory-hint">
              Esta propriedade ainda não tem unidades. Cadastre uma em
              Propriedades.
            </p>
          )}
          {item && item.unit_id !== unit && validUnit && (
            <p role="status" className="inventory-hint">
              O item será vinculado à nova unidade. Os checklists existentes
              mantêm suas próprias versões.
            </p>
          )}
          <label className="field">
            <span>Nome do item</span>
            <input
              required
              maxLength={160}
              value={name}
              placeholder="Ex.: copo de vidro"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="field inventory-quantity-field">
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
                <input
                  list="inventory-rooms"
                  maxLength={100}
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                />
                <datalist id="inventory-rooms">
                  {rooms.map((r) => (
                    <option key={r.id} value={r.name} />
                  ))}
                </datalist>
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
        </fieldset>
        <button
          className="button primary"
          disabled={saving || !validUnit || !name.trim()}
        >
          <Check size={17} />
          {saving ? 'Salvando…' : item ? 'Salvar alterações' : 'Cadastrar item'}
        </button>
      </form>
    </Modal>
  );
}
