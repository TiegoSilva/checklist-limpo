import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyData, selectItems, type Item } from '../src/domain';
import ChecklistCatalog from '../src/features/ChecklistCatalog';
import { ChecklistPreview } from '../src/features/ChecklistPreview';
import TemplateEditor from '../src/features/TemplateEditor';
import { latestTemplates } from '../src/features/checklists';

const towel: Item = {
  id: 'towel',
  room: 'Banheiro',
  title: 'Toalhas de banho',
  mode: 'count',
  required: true,
  evidence_required: false,
  expected: 2,
  quantity_per_guest: 1,
};
const data = {
  ...emptyData,
  units: [
    {
      id: 'unit',
      property_id: 'property',
      name: 'Unidade de teste',
      capacity: 4,
      base_occupancy: 2,
      operational_status: 'preparing',
      commercially_available: false,
    },
  ],
  checklist_template_versions: [
    {
      id: 'old',
      unit_id: 'unit',
      kind: 'cleaning',
      version: 1,
      items: [towel],
    },
    {
      id: 'current',
      unit_id: 'unit',
      kind: 'cleaning',
      version: 2,
      items: [{ ...towel, expected: 3 }],
    },
    {
      id: 'inspection',
      unit_id: 'unit',
      kind: 'inspection',
      version: 2,
      items: [towel],
    },
  ],
};
describe('configuração e prévia de checklists', () => {
  it('seleciona a versão mais recente de cada tipo mesmo fora de ordem', () => {
    expect(
      latestTemplates([...data.checklist_template_versions].reverse())
        .map((t) => t.id)
        .sort(),
    ).toEqual(['current', 'inspection']);
  });
  it('exibe ações distintas de editar e visualizar, preservando acesso ao histórico', () => {
    const html = renderToStaticMarkup(
      <ChecklistCatalog
        data={data}
        onEdit={vi.fn()}
        onPreview={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(html.match(/Editar modelo/g)).toHaveLength(2);
    expect(html.match(/Ver prévia/g)).toHaveLength(3);
    expect(html).toContain('Versões anteriores (1)');
  });
  it('abre o checklist criado com nome, quantidade e seletores de mais e menos', () => {
    const html = renderToStaticMarkup(
      <TemplateEditor
        data={data}
        templateId="current"
        onClose={vi.fn()}
        run={vi.fn()}
      />,
    );
    expect(html).toContain('Editar modelo');
    expect(html).toContain('value="Toalhas de banho"');
    expect(html).toContain('Aumentar quantidade de toalhas de banho');
    expect(html).toContain('Diminuir quantidade de toalhas de banho');
    expect(html).toContain('Salvar alterações');
  });
  it('permite simular a prévia sem apresentar submissão ou aprovação reais', () => {
    const html = renderToStaticMarkup(
      <ChecklistPreview
        items={[towel]}
        unit={data.units[0]}
        kind="cleaning"
        version={2}
      />,
    );
    expect(html).toContain('Prévia do checklist');
    expect(html).toContain('Nenhuma resposta será salva');
    expect(html).toContain('Quantidade esperada: <strong>2</strong>');
    expect(html).not.toMatch(
      /Enviar para aprovação|Concluir vistoria|type="file"/,
    );
  });
  it('calcula na prévia as mesmas quantidades condicionais da execução', () => {
    const items = selectItems(
      [
        towel,
        { ...towel, id: 'extra', title: 'Travesseiro extra', min_guests: 3 },
      ],
      4,
    );
    expect(items).toHaveLength(2);
    expect(items[0].expected).toBe(4);
    expect(selectItems(items, 2)).toHaveLength(1);
  });
});
