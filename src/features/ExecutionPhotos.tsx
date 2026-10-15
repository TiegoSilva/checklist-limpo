import { useEffect, useState } from 'react';
import { Camera, Image, X } from 'lucide-react';
import type { Evidence } from '../domain';
import type { ExecutionPhoto } from '../lib/client';
import { MAX_EXECUTION_PHOTOS } from './execution';

function PhotoDraft({ photo }: { photo: ExecutionPhoto }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(photo.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo.file]);
  return (
    <img src={url} alt={photo.file.name || 'Foto da vistoria no rascunho'} />
  );
}
export default function ExecutionPhotos({
  photos,
  evidence,
  attempt,
  editable,
  onChange,
  onError,
  onView,
}: {
  photos: ExecutionPhoto[];
  evidence: Evidence[];
  attempt: number;
  editable: boolean;
  onChange: (photos: ExecutionPhoto[]) => void;
  onError: (error: string) => void;
  onView: (photo: Evidence) => Promise<void>;
}) {
  const current = evidence.filter((e) => !e.attempt || e.attempt === attempt);
  const pending = photos.filter((p) => !evidence.some((e) => e.id === p.id));
  const count = current.length + pending.length;
  return (
    <section className="room-section execution-photos">
      <h3>
        <Camera size={18} />
        Fotos da vistoria{' '}
        <small>
          {count}/{MAX_EXECUTION_PHOTOS}
        </small>
      </h3>
      <p className="muted">
        Reúna as fotos da execução aqui. Você pode tirar fotos pela câmera ou
        selecionar imagens, até 8 por envio.
      </p>
      <div className="execution-photo-grid">
        {current.map((e, index) => (
          <button
            key={e.id}
            className="button secondary"
            onClick={() => void onView(e)}
          >
            <Image size={17} />
            Foto {index + 1} recebida
          </button>
        ))}
        {pending.map((photo, index) => (
          <article key={photo.id} className="execution-photo-draft">
            <PhotoDraft photo={photo} />
            <span>
              Foto {current.length + index + 1} ·{' '}
              {photo.uploaded ? 'Recebida' : 'No rascunho'}
            </span>
            {editable && !photo.uploaded && (
              <button
                className="icon-button"
                aria-label={`Remover foto ${current.length + index + 1}`}
                onClick={() =>
                  onChange(photos.filter((p) => p.id !== photo.id))
                }
              >
                <X size={16} />
              </button>
            )}
          </article>
        ))}
      </div>
      {editable && (
        <label className="button secondary file-button">
          <Camera size={17} />
          Adicionar fotos ({count}/8)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            multiple
            disabled={count >= MAX_EXECUTION_PHOTOS}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (!files.length) return;
              if (count + files.length > MAX_EXECUTION_PHOTOS) {
                onError(
                  'Você pode enviar até 8 fotos. As fotos anteriores foram mantidas.',
                );
                return;
              }
              if (
                files.some(
                  (f) =>
                    !['image/jpeg', 'image/png', 'image/webp'].includes(
                      f.type,
                    ) || f.size > 10 * 1024 * 1024,
                )
              ) {
                onError('Use fotos JPG, PNG ou WebP de até 10 MB cada.');
                return;
              }
              onError('');
              onChange([
                ...photos,
                ...files.map((file) => ({ id: crypto.randomUUID(), file })),
              ]);
            }}
          />
        </label>
      )}
      {evidence.some((e) => e.attempt && e.attempt !== attempt) && (
        <details>
          <summary>Fotos de tentativas anteriores</summary>
          <div className="button-row">
            {evidence
              .filter((e) => e.attempt && e.attempt !== attempt)
              .map((e, i) => (
                <button
                  key={e.id}
                  className="button secondary"
                  onClick={() => void onView(e)}
                >
                  Foto anterior {i + 1}
                </button>
              ))}
          </div>
        </details>
      )}
    </section>
  );
}
