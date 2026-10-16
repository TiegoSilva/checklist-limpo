import { ArrowRight, House, Pencil, Package } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Empty } from '../components';
import type { Data } from '../domain';
import {
  inventoryCategories,
  inventoryGroups,
  type InventoryItem,
} from './inventory';

export default function InventoryCatalog({
  data,
  property,
  unit,
  search,
  manager,
  onUnitChange,
  onClearFilters,
  onCreate,
  onEdit,
  onOpenUnit,
  onOpenProperty,
  canManageUnit = () => manager,
}: {
  data: Data;
  property: string;
  unit: string;
  search: string;
  manager: boolean;
  onUnitChange: (id: string) => void;
  onClearFilters: () => void;
  onCreate: (unit?: string) => void;
  onEdit: (item: InventoryItem) => void;
  onOpenUnit: (id: string) => void;
  onOpenProperty: (id: string) => void;
  canManageUnit?: (id: string) => boolean;
}) {
  const groups = inventoryGroups(data, property, unit, search);
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const units = data.units.filter(
    (u) => !property || u.property_id === property,
  );
  const filtered = Boolean(property || unit || search.trim());
  const hasItems = data.inventory_items.some((i) => i.active !== false);
  return (
    <section
      className="panel inventory-catalog"
      aria-label="Inventário por unidade"
    >
      <div className="inventory-toolbar">
        <p className="muted" role="status">
          {total} {total === 1 ? 'item' : 'itens'} · {groups.length}{' '}
          {groups.length === 1 ? 'unidade' : 'unidades'}
        </p>
        <label className="field">
          <span className="sr-only">Unidade</span>
          <select value={unit} onChange={(e) => onUnitChange(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((u) => (
              <option value={u.id} key={u.id}>
                {u.name}
                {!property
                  ? ` · ${data.properties.find((p) => p.id === u.property_id)?.name ?? ''}`
                  : ''}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button className="inventory-clear" onClick={onClearFilters}>
            Limpar filtros
          </button>
        )}
      </div>
      {groups.map((group) => (
        <section
          className="inventory-group"
          key={group.unit.id}
          aria-label={`Inventário de ${group.unit.name} · ${group.property?.name}`}
        >
          <header className="inventory-group-head">
            <span className="inventory-unit-icon">
              <House size={20} />
            </span>
            <div>
              <NavLink
                className="inventory-property-link"
                to="/propriedades"
                onClick={() => onOpenProperty(group.unit.property_id)}
              >
                {group.property?.name}
              </NavLink>
              <button
                className="inventory-unit-link"
                onClick={() => onOpenUnit(group.unit.id)}
              >
                {group.unit.name}
                <ArrowRight size={15} />
              </button>
            </div>
            {manager && canManageUnit(group.unit.id) && !unit && (
              <button
                className="button secondary"
                onClick={() => onCreate(group.unit.id)}
              >
                Adicionar item
              </button>
            )}
          </header>
          <ul className="inventory-items">
            {group.items.map((item) => (
              <li className="inventory-item" key={item.id}>
                <span className="inventory-item-icon">
                  <Package size={18} />
                </span>
                <div className="inventory-item-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.room} ·{' '}
                    {inventoryCategories[item.category] ?? item.category}
                  </small>
                </div>
                <span className="inventory-item-quantity">
                  <strong>{item.expected}</strong>
                  <small>un.</small>
                </span>
                {manager && canManageUnit(group.unit.id) && (
                  <button
                    className="icon-button"
                    aria-label={`Editar ${item.name} · ${group.unit.name} · ${group.property?.name}`}
                    title="Editar item"
                    onClick={() => onEdit(item)}
                  >
                    <Pencil size={18} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!total && (
        <Empty
          title={
            hasItems || filtered
              ? 'Nenhum item nos filtros selecionados'
              : 'Inventário organizado por unidade'
          }
          description={
            hasItems || filtered
              ? 'Altere a busca ou os filtros para encontrar os itens.'
              : 'Cadastre o item e escolha a propriedade e a unidade a que ele pertence.'
          }
        />
      )}
      {!data.units.length && (
        <p className="inventory-hint">
          Cadastre uma propriedade e uma unidade em{' '}
          <NavLink to="/propriedades">Propriedades</NavLink> para começar.
        </p>
      )}
    </section>
  );
}
