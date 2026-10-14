import type { Data } from '../domain';
export type Template = Data['checklist_template_versions'][number];
export function latestTemplates(templates: Template[]) {
  const latest = new Map<string, Template>();
  for (const template of templates) {
    const key = `${template.unit_id}:${template.kind}`;
    if (!latest.has(key) || latest.get(key)!.version < template.version)
      latest.set(key, template);
  }
  return [...latest.values()];
}
export const checklistLabel = (kind: string) =>
  kind === 'inspection'
    ? 'Vistoria de checkout'
    : 'Limpeza, arrumação e check-in';
