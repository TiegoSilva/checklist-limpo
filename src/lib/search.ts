export const searchText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
export function matchesSearch(value: string, query: string) {
  return searchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => searchText(value).includes(term));
}
