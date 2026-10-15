import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyData, selectItems, type Item } from '../src/domain';
import ChecklistCatalog from '../src/features/ChecklistCatalog';
import { ChecklistPreview } from '../src/features/ChecklistPreview';
import TemplateEditor from '../src/features/TemplateEditor';
import {
  latestTemplates,
  activeTemplates,
  duplicateItems,
} from '../src/features/checklists';

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
    expect(html.match(/title="Editar modelo"/g)).toHaveLength(2);
    expect(html.match(/title="Remover modelo"/g)).toHaveLength(2);
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

it('não oferece versões removidas como modelo ativo, mas mantém a versão para o histórico', () => {
  const templates = data.checklist_template_versions.map((t) => ({
    ...t,
    archived_at: t.kind === 'cleaning' ? '2026-10-15' : null,
  }));
  expect(activeTemplates(templates).map((t) => t.id)).toEqual(['inspection']);
  expect(latestTemplates(templates).map((t) => t.id)).toContain('current');
  const html = renderToStaticMarkup(
    <ChecklistCatalog
      data={{ ...data, checklist_template_versions: templates }}
      onEdit={vi.fn()}
      onPreview={vi.fn()}
      onCreate={vi.fn()}
      run={vi.fn()}
    />,
  );
  expect(html).toContain('Modelos removidos (1)');
  expect(html).toContain('Restaurar');
});

it('mantém modelos distintos na mesma unidade mesmo quando têm o mesmo tipo', () => {
  const models = [
    {
      ...data.checklist_template_versions[0],
      id: 'a1',
      model_id: 'a',
      name: 'Preparação rápida',
      version: 1,
    },
    {
      ...data.checklist_template_versions[0],
      id: 'b1',
      model_id: 'b',
      name: 'Preparação completa',
      version: 2,
    },
    {
      ...data.checklist_template_versions[0],
      id: 'a2',
      model_id: 'a',
      name: 'Preparação rápida revisada',
      version: 3,
    },
  ];
  expect(
    activeTemplates(models)
      .map((t) => t.id)
      .sort(),
  ).toEqual(['a2', 'b1']);
  const html = renderToStaticMarkup(
    <ChecklistCatalog
      data={{ ...data, checklist_template_versions: models }}
      onEdit={vi.fn()}
      onPreview={vi.fn()}
      onCreate={vi.fn()}
      onDuplicate={vi.fn()}
    />,
  );
  expect(html).toContain('Preparação rápida revisada');
  expect(html).toContain('Preparação completa');
  expect(html.match(/>Duplicar</g)).toHaveLength(2);
});
it('cria um modelo em branco com nome livre e oferece cópias sem selecionar tipos fixos', () => {
  const html = renderToStaticMarkup(
    <TemplateEditor data={data} run={vi.fn()} onClose={vi.fn()} />,
  );
  expect(html).toContain('Nome do modelo');
  expect(html).toContain('Modelo em branco');
  expect(html).toContain('Começar a partir de');
  expect(html).not.toContain('value="Toalhas de banho"');
  expect(html).not.toContain('<span>Checklist</span>');
});
it('abre uma cópia editável com destino independente e preserva todos os atributos dos itens', () => {
  const original = [
    {
      ...towel,
      instructions: 'Conferir manchas',
      reference_path: 'origem/foto',
    },
  ];
  const copied = duplicateItems(original);
  expect(copied[0].id).not.toBe(original[0].id);
  expect(copied[0]).toMatchObject({ ...original[0], id: copied[0].id });
  copied[0].expected = 8;
  expect(original[0].expected).toBe(2);
  const html = renderToStaticMarkup(
    <TemplateEditor
      data={data}
      duplicateId="current"
      run={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(html).toContain('Duplicar modelo de checklist');
  expect(html).toContain('Unidade de destino');
  expect(html).toContain('(cópia)');
  expect(html).toContain('value="Toalhas de banho"');
});
