import { useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { Empty } from '../components';
import { csv, download, dayKey, statusLabels, type Data } from '../domain';
const today = () => dayKey(new Date());
export default function Reports({
  data,
  property,
  person,
  unitName,
}: {
  data: Data;
  property: string;
  person: (id: string) => string;
  unitName: (id: string) => string;
}) {
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const [collaborator, setCollaborator] = useState('');
  const [kind, setKind] = useState('');
  const activities = data.activities.filter(
    (a) =>
      (!property ||
        data.units.find((u) => u.id === a.unit_id)?.property_id === property) &&
      (!collaborator || a.assignee === collaborator) &&
      (!kind || a.kind === kind) &&
      dayKey(new Date(a.created_at)) >= from &&
      dayKey(new Date(a.created_at)) <= to,
  );
  const average = (values: number[]) =>
    values.length
      ? `${Math.round(values.reduce((a, b) => a + b, 0) / values.length)} min`
      : '—';
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Resultados da operação</h2>
          <p>Execução e aprovação, acompanhadas separadamente.</p>
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() =>
              download(
                'aja-relatorio.csv',
                csv([
                  [
                    'Unidade',
                    'Atividade',
                    'Responsável',
                    'Status',
                    'Criada em',
                    'Enviada em',
                    'Aprovada em',
                  ],
                  ...activities.map((a) => [
                    unitName(a.unit_id),
                    a.title,
                    person(a.assignee),
                    statusLabels[a.status],
                    a.created_at,
                    a.submitted_at,
                    a.approved_at,
                  ]),
                ]),
              )
            }
          >
            <ArrowDownToLine size={16} />
            CSV
          </button>
          <button className="button secondary" onClick={() => window.print()}>
            <ArrowDownToLine size={16} />
            Salvar PDF
          </button>
        </div>
      </div>
      <div className="report-filters">
        <label className="field">
          <span>De</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Colaborador</span>
          <select
            value={collaborator}
            onChange={(e) => setCollaborator(e.target.value)}
          >
            <option value="">Todos</option>
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Todos</option>
            <option value="inspection">Vistoria</option>
            <option value="cleaning">Limpeza</option>
          </select>
        </label>
      </div>
      <div className="report-metrics">
        {[
          [
            'Vistorias concluídas',
            activities.filter(
              (a) => a.kind === 'inspection' && a.status === 'completed',
            ).length,
          ],
          [
            'Arrumações enviadas',
            activities.filter((a) => a.kind !== 'inspection' && a.submitted_at)
              .length,
          ],
          [
            'Arrumações aprovadas',
            activities.filter((a) => a.approved_at).length,
          ],
          [
            'Reprovações',
            data.checklist_review_cycles.filter(
              (r) =>
                r.decision === 'rejected' &&
                activities.some((a) => a.id === r.activity_id),
            ).length,
          ],
          [
            'Tempo médio de execução',
            average(
              activities
                .filter((a) => a.started_at && a.submitted_at)
                .map(
                  (a) =>
                    (Date.parse(a.submitted_at!) - Date.parse(a.started_at!)) /
                    60000,
                ),
            ),
          ],
          [
            'Tempo médio até aprovação',
            average(
              activities
                .filter((a) => a.approved_at && a.submitted_at)
                .map(
                  (a) =>
                    (Date.parse(a.approved_at!) - Date.parse(a.submitted_at!)) /
                    60000,
                ),
            ),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="report-criteria">
        Critério: atividades criadas de {from} a {to}, no fuso
        America/Sao_Paulo, respeitando os filtros selecionados. Médias
        calculadas somente para registros com ambos os horários. Limite atual de
        consulta: 1.000 registros por tabela.
      </p>
      {!activities.length && (
        <Empty
          title="Sem registros no período"
          description="Os resultados aparecerão conforme sua equipe executar e revisar as atividades."
        />
      )}
    </section>
  );
}
