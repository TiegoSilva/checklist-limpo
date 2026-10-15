import type { Data } from '../domain';
export type Template = Data['checklist_template_versions'][number];
export function latestTemplates(templates: Template[]) {
  const latest = new Map<string, Template>();
  for (const template of templates) {
    const key = template.model_id ?? `${template.unit_id}:${template.kind}`;
    if (!latest.has(key) || latest.get(key)!.version < template.version)
      latest.set(key, template);
  }
  return [...latest.values()];
}
export const checklistLabel = (kind: string) =>
  kind === 'inspection'
    ? 'Vistoria de checkout'
    : 'Limpeza, arrumação e check-in';

export const activeTemplates = (templates: Template[]) =>
  latestTemplates(templates).filter((t) => !t.archived_at);

export const templateName = (template: Template) =>
  template.name?.trim() || checklistLabel(template.kind);

export const duplicateItems = (items: Template['items']) =>
  items.map((item) => ({ ...item, id: crypto.randomUUID() }));
