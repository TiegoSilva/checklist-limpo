import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { emptyData, type Data } from '../src/domain';
import InventoryCatalog from '../src/features/InventoryCatalog';
import InventoryEditor from '../src/features/InventoryEditor';
import {
  inventoryGroups,
  inventoryLocation,
  inventoryManagementScope,
} from '../src/features/inventory';

const data: Data = {
  ...emptyData,
  properties: [
    { id: 'p1', org_id: 'org', name: 'Praia', address: '' },
    { id: 'p2', org_id: 'org', name: 'Centro', address: '' },
  ],
  units: ['p1', 'p2'].map((property_id, index) => ({
    id: `u${index + 1}`,
    property_id,
    name: 'Apartamento 101',
    capacity: 4,
    base_occupancy: 2,
    operational_status: 'ready',
    commercially_available: false,
  })),
  inventory_items: [
    {
      id: 'i1',
      unit_id: 'u1',
      name: 'Toalhas de banho',
      room: 'Banheiro',
      category: 'linen',
      expected: 4,
      revision: 2,
    },
    {
      id: 'i2',
      unit_id: 'u2',
      name: 'Copos',
      room: 'Cozinha',
      category: 'permanent',
      expected: 6,
    },
    {
      id: 'i3',
      unit_id: 'u1',
      name: 'Sabão',
      room: 'Área de serviço',
      category: 'consumable',
      expected: 2,
    },
    {
      id: 'i4',
      unit_id: 'u1',
      name: 'Item inativo',
      room: 'Geral',
      category: 'permanent',
      expected: 0,
      active: false,
    },
  ],
};
function catalog(property = '', unit = '', search = '', manager = true) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <InventoryCatalog
        data={data}
        property={property}
        unit={unit}
        search={search}
        manager={manager}
        onUnitChange={vi.fn()}
        onClearFilters={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onOpenUnit={vi.fn()}
        onOpenProperty={vi.fn()}
      />
    </MemoryRouter>,
  );
}
describe('vínculo do inventário com a unidade e a propriedade', () => {
  it('oferece edição apenas nas organizações em que o usuário é gestor ativo', () => {
    const multiOrg: Data = {
      ...data,
      properties: data.properties.map((p) => ({ ...p, org_id: p.id })),
      profiles: [{ id: 'user', name: 'Gestor', active: true, font_scale: 100 }],
      memberships: [
        { org_id: 'p1', user_id: 'user', roles: ['manager'] },
        { org_id: 'p2', user_id: 'user', roles: ['cleaner'] },
      ],
    };
    expect(
      inventoryManagementScope(multiOrg, 'user').units.map((u) => u.id),
    ).toEqual(['u1']);
    expect(
      inventoryManagementScope(
        { ...multiOrg, profiles: [{ ...multiOrg.profiles[0], active: false }] },
        'user',
      ).units,
    ).toEqual([]);
  });
  it('distingue unidades homônimas e respeita os dois filtros', () => {
    expect(inventoryGroups(data, 'p1')[0].items.map((i) => i.id)).toEqual([
      'i3',
      'i1',
    ]);
    expect(inventoryGroups(data, '', 'u2')[0].property?.id).toBe('p2');
    expect(inventoryGroups(data, 'p1', 'u2')).toEqual([]);
  });
  it('busca por item, ambiente, categoria, unidade e propriedade sem exigir acentos', () => {
    expect(inventoryGroups(data, '', '', 'sabao servico')[0].items[0].id).toBe(
      'i3',
    );
    expect(
      inventoryGroups(data, '', '', 'centro 101 patrimonio')[0].items[0].id,
    ).toBe('i2');
    expect(inventoryGroups(data, '', '', 'inativo')).toEqual([]);
  });
  it('pré-seleciona o vínculo da unidade e não escolhe unidades de outra propriedade', () => {
    expect(inventoryLocation(data, 'u2', 'p1')).toEqual({
      property: 'p2',
      unit: 'u2',
    });
    expect(inventoryLocation(data, '', 'p1')).toEqual({
      property: 'p1',
      unit: 'u1',
    });
    expect(inventoryLocation(data)).toEqual({ property: '', unit: '' });
  });
  it('mostra o caminho completo e ações de edição fora de uma tabela horizontal', () => {
    const html = catalog();
    expect(html).toContain('Inventário de Apartamento 101 · Praia');
    expect(html).toContain('Inventário de Apartamento 101 · Centro');
    expect(html).toContain('Editar Toalhas de banho · Apartamento 101 · Praia');
    expect(html).toContain('href="/propriedades"');
    expect(html).not.toContain('<table');
    expect(catalog('', '', '', false)).not.toContain('Editar Toalhas');
  });
  it('exibe um estado vazio quando o filtro não encontra itens, mesmo com inventário cadastrado', () => {
    expect(catalog('', '', 'inexistente')).toContain(
      'Nenhum item nos filtros selecionados',
    );
    expect(catalog('', '', 'inexistente')).toContain('Limpar filtros');
  });
  it('edita sem perder o vínculo e restringe o seletor de unidades à propriedade escolhida', () => {
    const html = renderToStaticMarkup(
      <InventoryEditor
        data={data}
        item={data.inventory_items[0]}
        run={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain('Editar item do inventário');
    expect(html).toContain('value="Toalhas de banho"');
    expect(html).toContain('<option value="u1" selected="">');
    expect(html).not.toContain('value="u2"');
    expect(html).toContain('Salvar alterações');
  });
});
