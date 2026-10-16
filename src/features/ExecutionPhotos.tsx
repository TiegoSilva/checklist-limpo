import { useEffect, useState } from 'react';
import { Camera, Image, Video, X } from 'lucide-react';
import type { Evidence } from '../domain';
import type { ExecutionPhoto, UploadProgress } from '../lib/client';
import { MAX_EXECUTION_PHOTOS } from './execution';
import {
  mediaError,
  isVideo,
  PHOTO_TYPES,
  VIDEO_TYPES,
  fileSize,
} from '../lib/media';

export function PhotoDraft({ photo }: { photo: ExecutionPhoto }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(photo.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo.file]);
  return isVideo(photo.file.type) ? (
    <video
      controls
      playsInline
      preload="metadata"
      src={url || undefined}
      aria-label={photo.file.name || 'Vídeo no rascunho'}
    />
  ) : (
    <img
      src={url || undefined}
      alt={photo.file.name || 'Foto da vistoria no rascunho'}
    />
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
  uploads = {},
}: {
  photos: ExecutionPhoto[];
  evidence: Evidence[];
  attempt: number;
  editable: boolean;
  onChange: (photos: ExecutionPhoto[]) => void;
  onError: (error: string) => void;
  onView: (photo: Evidence) => Promise<void>;
  uploads?: Record<string, UploadProgress>;
}) {
  const current = evidence.filter((e) => !e.attempt || e.attempt === attempt);
  const pending = photos.filter((p) => !evidence.some((e) => e.id === p.id));
  const count = current.length + pending.length;
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    if (count + files.length > MAX_EXECUTION_PHOTOS) {
      onError(
        'Você pode enviar até 8 arquivos entre fotos e vídeos. Os anteriores foram mantidos.',
      );
      return;
    }
    const bad = files.find((file) => mediaError(file));
    const invalid = bad
      ? `Arquivo “${bad.name}” (${fileSize(bad.size)}): ${mediaError(bad)}`
      : null;
    if (invalid) {
      onError(invalid);
      return;
    }
    onError('');
    onChange([
      ...photos,
      ...files.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
  };
  return (
    <section className="room-section execution-photos">
      <h3>
        <Camera size={18} />
        Evidências da vistoria{' '}
        <small>
          {count}/{MAX_EXECUTION_PHOTOS}
        </small>
      </h3>
      <p className="muted">
        Até 8 arquivos por envio: fotos de até 25 MB ou vídeos de até 200 MB. A
        aprovação só é solicitada após a confirmação de todos os arquivos.
      </p>
      <div className="execution-photo-grid">
        {current.map((e, index) => (
          <button
            key={e.id}
            className="button secondary"
            onClick={() => void onView(e)}
          >
            {isVideo(e.mime_type) ? <Video size={17} /> : <Image size={17} />}
            {isVideo(e.mime_type) ? 'Vídeo' : 'Foto'} {index + 1}
            <small>{fileSize(e.file_size)} · Recebido</small>
          </button>
        ))}
        {pending.map((photo, index) => (
          <article key={photo.id} className="execution-photo-draft">
            <PhotoDraft photo={photo} />
            <span>
              {isVideo(photo.file.type) ? 'Vídeo' : 'Foto'}{' '}
              {current.length + index + 1} · {fileSize(photo.file.size)} ·{' '}
              {photo.uploaded
                ? 'Recebido'
                : uploads[photo.id]?.phase === 'receipt'
                  ? 'Confirmando recebimento…'
                  : uploads[photo.id]
                    ? `Enviando ${uploads[photo.id].percent}%`
                    : 'No rascunho'}
            </span>
            <small className="evidence-filename">{photo.file.name}</small>
            {uploads[photo.id] && !photo.uploaded && (
              <progress
                max={100}
                value={uploads[photo.id].percent}
                aria-label={`Envio de ${photo.file.name}`}
              />
            )}
            {editable && !photo.uploaded && (
              <button
                className="icon-button"
                aria-label={`Remover arquivo ${current.length + index + 1}`}
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
        <div className="button-row evidence-inputs">
          <label className="button secondary file-button">
            <Camera size={17} />
            Adicionar fotos ({count}/8)
            <input
              type="file"
              accept={PHOTO_TYPES.join(',')}
              capture="environment"
              multiple
              disabled={count >= MAX_EXECUTION_PHOTOS}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
          <label className="button secondary file-button">
            <Video size={17} />
            Adicionar vídeo
            <input
              type="file"
              accept={VIDEO_TYPES.join(',')}
              capture="environment"
              disabled={count >= MAX_EXECUTION_PHOTOS}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}
      {evidence.some((e) => e.attempt && e.attempt !== attempt) && (
        <details>
          <summary>Evidências de tentativas anteriores</summary>
          <div className="button-row">
            {evidence
              .filter((e) => e.attempt && e.attempt !== attempt)
              .map((e, i) => (
                <button
                  key={e.id}
                  className="button secondary"
                  onClick={() => void onView(e)}
                >
                  {isVideo(e.mime_type) ? 'Vídeo' : 'Foto'} anterior {i + 1}
                </button>
              ))}
          </div>
        </details>
      )}
    </section>
  );
}
