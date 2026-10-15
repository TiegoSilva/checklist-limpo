import { useState } from 'react';
import { Camera, Check, Eye, House, Image } from 'lucide-react';
import { Modal } from '../components';
import { selectItems, type Item, type Unit } from '../domain';
import { signedImage } from '../lib/client';
import QuantityStepper from './QuantityStepper';
import { checklistLabel, type Template } from './checklists';

export function ChecklistPreview({
  items,
  unit,
  kind,
  version,
}: {
  items: Item[];
  unit?: Unit;
  kind: string;
  version?: number;
}) {
  const [occupancy, setOccupancy] = useState(unit?.base_occupancy ?? 1);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<{ url: string; title: string }>();
  const [error, setError] = useState('');
  const applicable = selectItems(items, occupancy);
  return (
    <div className="checklist-preview">
      <div className="preview-notice">
        <Eye size={20} />
        <p>
          <strong>Prévia do checklist</strong>
          <br />
          Você pode testar as respostas aqui. Nenhuma resposta será salva e
          nenhuma atividade será criada.
        </p>
      </div>
      <div className="preview-heading">
        <div>
          <h3>
            {unit?.name ?? 'Unidade'} · {checklistLabel(kind)}
          </h3>
          <p>
            {version ? `Versão ${version}` : 'Alterações ainda não publicadas'}
          </p>
        </div>
        <div className="field">
          <span>Quantidade de hóspedes</span>
          <QuantityStepper
            label="Quantidade de hóspedes na prévia"
            min={1}
            max={unit?.capacity ?? 99}
            value={occupancy}
            onChange={(next) => {
              setOccupancy(next);
              setConfirmed([]);
              setCounts({});
              setAnswers({});
            }}
          />
        </div>
      </div>
      <p className="muted">
        {applicable.length} itens e tarefas aplicáveis · {confirmed.length}{' '}
        conferidos nesta prévia
      </p>
      {[...new Set(applicable.map((i) => i.room))].map((room) => (
        <section className="room-section" key={room}>
          <h3>
            <House size={17} />
            {room}
          </h3>
          {applicable
            .filter((i) => i.room === room)
            .map((i) => (
              <article
                className={`checklist-item ${i.mode === 'count' ? 'count-inline preview-count-inline' : ''}`}
                key={i.id}
              >
                <div className="checklist-item-title">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={confirmed.includes(i.id)}
                      onChange={(e) =>
                        setConfirmed((prev) =>
                          e.target.checked
                            ? [...prev, i.id]
                            : prev.filter((id) => id !== i.id),
                        )
                      }
                    />
                    <strong>{i.title || 'Item sem nome'}</strong>
                  </label>
                  {i.required && <span className="required">Obrigatório</span>}
                </div>
                {i.instructions && <p className="muted">{i.instructions}</p>}
                {i.mode === 'count' && (
                  <div className="counter-row">
                    <span>
                      Quantidade esperada: <strong>{i.expected ?? 0}</strong>
                    </span>
                    <div className="field">
                      <span className="sr-only">Quantidade encontrada</span>
                      <QuantityStepper
                        label={`Quantidade encontrada de ${i.title}`}
                        value={counts[i.id] ?? 0}
                        onChange={(n) =>
                          setCounts((prev) => ({ ...prev, [i.id]: n }))
                        }
                      />
                    </div>
                    {counts[i.id] !== undefined &&
                      counts[i.id] !== i.expected && (
                        <span className="error-text">
                          Quantidade divergente
                        </span>
                      )}
                  </div>
                )}
                {i.mode === 'technical' && (
                  <label className="field">
                    <span>Conferência técnica</span>
                    <select
                      value={answers[i.id] ?? ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [i.id]: e.target.value,
                        }))
                      }
                    >
                      <option value="">Selecione</option>
                      <option value="ok">Conforme</option>
                      <option value="issue">Não conforme</option>
                      {i.allow_na && <option value="na">Não se aplica</option>}
                    </select>
                  </label>
                )}
                <div className="button-row">
                  {i.reference_path && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={async () => {
                        setError('');
                        try {
                          setPhoto({
                            url: await signedImage(
                              'references',
                              i.reference_path!,
                            ),
                            title: i.title,
                          });
                        } catch {
                          setError(
                            'Não foi possível abrir a foto de referência.',
                          );
                        }
                      }}
                    >
                      <Image size={16} />
                      Ver foto de referência
                    </button>
                  )}
                  {i.evidence_required && (
                    <span className="preview-evidence">
                      <Camera size={16} />
                      Fotografia obrigatória na execução
                    </span>
                  )}
                </div>
              </article>
            ))}
        </section>
      ))}
      {!applicable.length && (
        <p className="info-card">Nenhum item se aplica a essa ocupação.</p>
      )}
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {photo && (
        <div className="image-viewer">
          <strong>{photo.title} · Referência</strong>
          <img src={photo.url} alt={`Foto de referência: ${photo.title}`} />
          <button
            type="button"
            className="text-button"
            onClick={() => setPhoto(undefined)}
          >
            Fechar foto
          </button>
        </div>
      )}
      <div className="panel-footer">
        <Check size={16} />
        Prévia sem gravação. O envio real exige validação e aprovação.
      </div>
    </div>
  );
}
export default function ChecklistPreviewDialog({
  template,
  unit,
  onClose,
}: {
  template: Template;
  unit?: Unit;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Visualizar checklist"
      onClose={onClose}
      wide
      className="checklist-modal"
    >
      <ChecklistPreview
        items={template.items}
        unit={unit}
        kind={template.kind}
        version={template.version}
      />
    </Modal>
  );
}
