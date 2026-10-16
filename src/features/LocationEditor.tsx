import { useState } from 'react';
import { Modal } from '../components';
import type { Property, Unit } from '../domain';
import { rpc, type Run } from '../lib/client';
import { describeError } from '../lib/errors';
import QuantityStepper from './QuantityStepper';
export default function LocationEditor({
  location,
  kind,
  run,
  onClose,
}: {
  location: Property | Unit;
  kind: 'property' | 'unit';
  run: Run;
  onClose: () => void;
}) {
  const [name, setName] = useState(location.name),
    [address, setAddress] = useState(
      'address' in location ? location.address : '',
    ),
    [capacity, setCapacity] = useState(
      'capacity' in location ? location.capacity : 1,
    ),
    [base, setBase] = useState(
      'base_occupancy' in location ? location.base_occupancy : 1,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title={kind === 'unit' ? 'Editar unidade' : 'Editar propriedade'}
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
              await rpc('save_location', {
                kind,
                payload: {
                  id: location.id,
                  revision: location.revision ?? 0,
                  name: name.trim(),
                  address,
                  capacity,
                  base_occupancy: base,
                },
              });
            } catch (e) {
              setError(describeError(e));
              throw e;
            }
          }, 'Cadastro atualizado.');
          setBusy(false);
          if (ok) onClose();
        }}
      >
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <label className="field">
          Nome
          <input
            required
            maxLength={160}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {kind === 'property' ? (
          <label className="field">
            Endereço
            <input
              value={address}
              disabled={busy}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
        ) : (
          <>
            <div className="inventory-quantity-field">
              <span>Capacidade</span>
              <QuantityStepper
                value={capacity}
                min={1}
                label="Capacidade da unidade"
                onChange={(n) => {
                  setCapacity(n);
                  setBase(Math.min(base, n));
                }}
                disabled={busy}
              />
            </div>
            <div className="inventory-quantity-field">
              <span>Ocupação-base</span>
              <QuantityStepper
                value={base}
                min={1}
                max={capacity}
                label="Ocupação-base"
                onChange={setBase}
                disabled={busy}
              />
            </div>
          </>
        )}
        <button className="button primary" disabled={busy || !name.trim()}>
          {busy ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </form>
    </Modal>
  );
}
