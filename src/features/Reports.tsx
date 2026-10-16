import { useState, useEffect } from 'react';
import { configured, loadReportPeriod } from '../lib/client';
import { describeError } from '../lib/errors';
import { ArrowDownToLine } from 'lucide-react';
import { Empty, Badge } from '../components';
import { csv, download, dayKey, statusLabels, type Data } from '../domain';
import {
  filterReportRows,
  recurringFindings,
  type ReportRow,
} from './reporting';
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
  const today = dayKey(new Date());
  const [from, setFrom] = useState(today.slice(0, 8) + '01'),
    [to, setTo] = useState(today),
    [collaborator, setCollaborator] = useState(''),
    [kind, setKind] = useState(''),
    [criterion, setCriterion] = useState<
      'due_at' | 'created_at' | 'submitted_at' | 'approved_at'
    >('due_at');
  const [remote, setRemote] = useState<Data | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!configured || !from || !to || from > to) return;
    let active = true;
    setLoading(true);
    setError('');
    void loadReportPeriod(property, from, to, criterion)
      .then((result) => {
        if (!active || !result) return;
        const allLinked = new Set(
          data.service_orders.map((s) => s.activity_id),
        );
        const selectedLinked = new Set(
          result.service_orders.map((s) => s.activity_id),
        );
        setRemote({
          ...data,
          service_orders: result.service_orders,
          activities: [
            ...result.activities.filter((a) => !allLinked.has(a.id)),
            ...data.activities.filter((a) => selectedLinked.has(a.id)),
          ],
        });
      })
      .catch((e) => {
        if (active) setError(describeError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [data, property, from, to, criterion]);
  const rows =
    from && to && from <= to
      ? filterReportRows(remote ?? data, {
          from,
          to,
          property,
          person: collaborator,
          kind,
          criterion,
        })
      : [];
  const issues = recurringFindings(data, from, to, property);
  const propertyName = (unit: string) =>
    data.properties.find(
      (p) => p.id === data.units.find((u) => u.id === unit)?.property_id,
    )?.name ?? '';
  const average = (
    first: 'started_at' | 'submitted_at',
    second: 'submitted_at' | 'approved_at',
  ) => {
    const times = rows
      .filter(
        (r) =>
          r[first] &&
          r[second] &&
          Date.parse(r[second]!) >= Date.parse(r[first]!),
      )
      .map((r) => (Date.parse(r[second]!) - Date.parse(r[first]!)) / 60000);
    return times.length
      ? `${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} min (${times.length} ordens)`
      : 'Sem horários suficientes';
  };
  const kindLabel = (row: ReportRow) =>
    row.kind === 'checkin'
      ? 'Check-in'
      : row.kind === 'checkout'
        ? 'Checkout'
        : 'Tarefa';
  return (
    <section className="panel report-panel">
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {loading && <p role="status">Consultando o período no servidor…</p>}
      {(!from || !to || from > to) && (
        <p role="alert" className="alert error">
          Informe um período válido.
        </p>
      )}
      <div className="section-heading">
        <div>
          <h2>Resultados da operação</h2>
          <p>
            Check-ins, checkouts e tarefas, sem duplicar as execuções
            vinculadas.
          </p>
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={loading || Boolean(error) || !from || !to || from > to}
            onClick={() =>
              download(
                'aja-relatorio.csv',
                csv([
                  [
                    'Propriedade',
                    'Unidade',
                    'Tipo',
                    'Ordem',
                    'Responsável',
                    'Status',
                    'Criada em',
                    'Programada para',
                    'Enviada em',
                    'Aprovada em',
                  ],
                  ...rows.map((r) => [
                    propertyName(r.unit_id),
                    unitName(r.unit_id),
                    kindLabel(r),
                    r.title,
                    person(r.assignee),
                    statusLabels[r.status],
                    r.created_at,
                    r.due_at,
                    r.submitted_at,
                    r.approved_at,
                  ]),
                ]),
              )
            }
          >
            <ArrowDownToLine size={16} /> CSV
          </button>
          <button className="button secondary" onClick={() => window.print()}>
            Salvar PDF
          </button>
        </div>
      </div>
      <div className="workspace-filters">
        <label className="field">
          De
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          Até
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="field">
          Critério de data
          <select
            value={criterion}
            onChange={(e) => setCriterion(e.target.value as typeof criterion)}
          >
            <option value="due_at">Programação</option>
            <option value="created_at">Criação</option>
            <option value="submitted_at">Envio</option>
            <option value="approved_at">Aprovação</option>
          </select>
        </label>
        <label className="field">
          Responsável
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
          Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Todos</option>
            <option value="checkin">Check-in</option>
            <option value="checkout">Checkout</option>
            <option value="task">Tarefa</option>
          </select>
        </label>
      </div>
      <div className="report-metrics">
        {[
          ['Ordens no período', rows.length],
          [
            'Aguardando aprovação',
            rows.filter((r) => r.status === 'review').length,
          ],
          [
            'Concluídas',
            rows.filter((r) => ['completed', 'approved'].includes(r.status))
              .length,
          ],
          ['Tempo de execução', average('started_at', 'submitted_at')],
          ['Tempo até aprovação', average('submitted_at', 'approved_at')],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="report-criteria">
        Período de {from} a {to}, por{' '}
        {
          {
            due_at: 'programação',
            created_at: 'criação',
            submitted_at: 'envio',
            approved_at: 'aprovação',
          }[criterion]
        }
        , em America/Sao_Paulo. Registros sem a data escolhida não entram no
        período. CSV e lista usam os mesmos filtros. As consultas são paginadas,
        sem corte nos primeiros 1.000 registros.
      </p>
      <div className="report-records">
        {rows.map((r) => (
          <article className="simple-row" key={r.id}>
            <div>
              <strong>{r.title}</strong>
              <small>
                {propertyName(r.unit_id)} · {unitName(r.unit_id)} ·{' '}
                {kindLabel(r)}
              </small>
            </div>
            <Badge status={r.status} />
          </article>
        ))}
      </div>
      {!rows.length && (
        <Empty
          title="Sem registros no período"
          description="Altere as datas, o critério ou os filtros para consultar outras ordens."
        />
      )}
      <details className="room-section">
        <summary>Divergências recorrentes confirmadas</summary>
        <p className="muted">
          Tentativas aprovadas no período por data da revisão e propriedade.
          Cada tentativa conta uma vez. Não altera a quantidade padrão do
          inventário. Itens sem vínculo estável permanecem separados para evitar
          juntar registros diferentes.
        </p>
        {issues.length ? (
          issues.map((issue, index) => (
            <article className="simple-row" key={index}>
              <div>
                <strong>{issue.item}</strong>
                <small>
                  {unitName(issue.unit)} · {propertyName(issue.unit)}
                </small>
              </div>
              <span>
                {issue.events} ocorrências · {issue.divergent} de quantidade ·{' '}
                {issue.damaged} de dano
              </span>
            </article>
          ))
        ) : (
          <p>Nenhuma divergência confirmada neste período.</p>
        )}
      </details>
    </section>
  );
}
