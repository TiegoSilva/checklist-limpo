import { useState } from 'react';
import { Modal } from '../components';
import type { Data } from '../domain';
import { rpc, type Run } from '../lib/client';
import { describeError } from '../lib/errors';
import QuantityStepper from './QuantityStepper';
type Row = {
  id?: string;
  revision?: number;
  name: string;
  room: string;
  category: string;
  expected: number;
};
export default function InventoryBatchEditor({
  data,
  initialUnit = '',
  run,
  onClose,
}: {
  data: Data;
  initialUnit?: string;
  run: Run;
  onClose: () => void;
}) {
  const [unit, setUnit] = useState(initialUnit),
    [source, setSource] = useState(''),
    [rows, setRows] = useState<Row[]>(
      data.inventory_items.filter(
        (i) => i.unit_id === initialUnit && i.active !== false,
      ),
    ),
    [batch] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const label = (id: string) => {
    const u = data.units.find((u) => u.id === id);
    return `${data.properties.find((p) => p.id === u?.property_id)?.name} · ${u?.name}`;
  };
  const load = (destination: string, origin: string) =>
    setRows(
      data.inventory_items
        .filter(
          (i) => i.unit_id === (origin || destination) && i.active !== false,
        )
        .filter(
          (i) =>
            !origin ||
            !data.inventory_items.some(
              (existing) =>
                existing.unit_id === destination &&
                existing.active !== false &&
                existing.name.trim().toLowerCase() ===
                  i.name.trim().toLowerCase() &&
                existing.room.trim().toLowerCase() ===
                  i.room.trim().toLowerCase(),
            ),
        )
        .map((i) =>
          origin
            ? {
                name: i.name,
                room: i.room,
                category: i.category,
                expected: i.expected,
              }
            : i,
        ),
    );
  return (
    <Modal
      title="Ajustar ou copiar inventário"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const ok = await run(async () => {
            try {
              await rpc('save_inventory_batch', {
                destination: unit,
                items: rows,
                batch,
              });
            } catch (e) {
              setError(describeError(e));
              throw e;
            }
          }, 'Inventário atualizado.');
          setBusy(false);
          if (ok) onClose();
        }}
      >
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          Unidade de destino
          <select
            required
            value={unit}
            disabled={busy}
            onChange={(e) => {
              setUnit(e.target.value);
              setSource('');
              load(e.target.value, '');
            }}
          >
            <option value="">Selecione</option>
            {data.units.map((u) => (
              <option key={u.id} value={u.id}>
                {label(u.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Origem dos itens
          <select
            value={source}
            disabled={busy || !unit}
            onChange={(e) => {
              setSource(e.target.value);
              load(unit, e.target.value);
            }}
          >
            <option value="">Editar itens desta unidade</option>
            {data.units
              .filter((u) => u.id !== unit)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  Copiar de {label(u.id)}
                </option>
              ))}
          </select>
        </label>
        <p className="muted">
          {source
            ? 'Somente itens ainda não cadastrados no mesmo ambiente serão copiados. Revise as quantidades antes de salvar.'
            : 'Altere as quantidades em linha. Modelos e ordens existentes serão preservados.'}
        </p>
        <div className="inventory-batch-list">
          {rows.map((row, index) => (
            <div className="inventory-batch-row" key={row.id ?? index}>
              <label className="field">
                <span>{row.room}</span>
                <input
                  required
                  maxLength={160}
                  aria-label={`Item ${index + 1}`}
                  value={row.name}
                  disabled={busy}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === index ? { ...r, name: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <QuantityStepper
                label={`Quantidade de ${row.name}`}
                value={row.expected}
                disabled={busy}
                onChange={(expected) =>
                  setRows((prev) =>
                    prev.map((r, i) => (i === index ? { ...r, expected } : r)),
                  )
                }
              />
            </div>
          ))}
        </div>
        {!rows.length && (
          <p role="status">
            Nenhum item para{' '}
            {source
              ? 'copiar; os itens desta origem já podem estar cadastrados'
              : 'editar nesta unidade'}
            .
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !unit || !rows.length}
        >
          {busy ? 'Salvando…' : `Salvar ${rows.length} itens`}
        </button>
      </form>
    </Modal>
  );
}
