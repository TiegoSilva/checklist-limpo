import type { Data } from '../domain';

export type InventoryItem = Data['inventory_items'][number];
export function inventoryManagementScope(data: Data, user: string) {
  const active = data.profiles.some((p) => p.id === user && p.active);
  // As propriedades recebidas já respeitam o escopo de leitura da RLS.
  const properties = data.properties.filter(
    (p) =>
      active &&
      data.memberships.some(
        (m) =>
          m.user_id === user &&
          m.org_id === p.org_id &&
          m.roles.some((role) => role === 'admin' || role === 'manager'),
      ),
  );
  const units = data.units.filter((u) =>
    properties.some((p) => p.id === u.property_id),
  );
  return { ...data, properties, units };
}
export const inventoryCategories: Record<string, string> = {
  permanent: 'Patrimônio',
  linen: 'Enxoval',
  consumable: 'Consumo',
};
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

export function inventoryGroups(
  data: Data,
  property = '',
  unit = '',
  search = '',
) {
  const terms = normalize(search.trim()).split(/\s+/).filter(Boolean);
  return data.units
    .filter(
      (u) =>
        (!property || u.property_id === property) && (!unit || u.id === unit),
    )
    .map((u) => {
      const parent = data.properties.find((p) => p.id === u.property_id);
      const items = data.inventory_items
        .filter((i) => {
          if (i.unit_id !== u.id || i.active === false) return false;
          const text = normalize(
            [
              i.name,
              i.room,
              inventoryCategories[i.category],
              u.name,
              parent?.name,
            ].join(' '),
          );
          return terms.every((term) => text.includes(term));
        })
        .sort(
          (a, b) =>
            a.room.localeCompare(b.room, 'pt-BR') ||
            a.name.localeCompare(b.name, 'pt-BR'),
        );
      return { unit: u, property: parent, items };
    })
    .filter((group) => group.items.length)
    .sort(
      (a, b) =>
        (a.property?.name ?? '').localeCompare(
          b.property?.name ?? '',
          'pt-BR',
        ) || a.unit.name.localeCompare(b.unit.name, 'pt-BR'),
    );
}

export function inventoryLocation(data: Data, unitId = '', propertyId = '') {
  const selected = data.units.find((u) => u.id === unitId);
  const availableProperty = data.properties.some((p) => p.id === propertyId)
    ? propertyId
    : '';
  const property =
    selected?.property_id ||
    availableProperty ||
    (data.properties.length === 1 ? data.properties[0].id : '');
  const units = data.units.filter((u) => u.property_id === property);
  return {
    property,
    unit: selected?.id || (units.length === 1 ? units[0].id : ''),
  };
}
