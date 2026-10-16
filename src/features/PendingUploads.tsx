import { useEffect, useState } from 'react';
import { rpc, configured } from '../lib/client';
import { describeError } from '../lib/errors';
export default function PendingUploads({
  kind,
  resource,
  localIds,
  active,
  busy,
  onError,
  onPending,
}: {
  kind: 'activity' | 'service';
  resource: string;
  localIds: string[];
  active: boolean;
  busy: boolean;
  onError: (message: string) => void;
  onPending: (pending: boolean) => void;
}) {
  const [orphans, setOrphans] = useState<string[]>([]),
    [working, setWorking] = useState(false);
  const ids = localIds.slice().sort().join(',');
  useEffect(() => {
    if (!active || busy || !configured) return;
    let mounted = true;
    const refresh = () => {
      if (!navigator.onLine) return;
      void rpc('pending_evidence_uploads', { kind, resource })
        .then((result) => {
          if (!mounted) return;
          const missing = (result as string[]).filter(
            (id) => !ids.split(',').includes(id),
          );
          setOrphans(missing);
          onPending(missing.length > 0);
        })
        .catch((e) => {
          if (mounted) onError(describeError(e));
        });
    };
    refresh();
    window.addEventListener('online', refresh);
    return () => {
      mounted = false;
      window.removeEventListener('online', refresh);
    };
  }, [kind, resource, ids, active, busy, onError, onPending]);
  if (!orphans.length || !active) return null;
  return (
    <section className="alert">
      <div>
        <strong>
          Há {orphans.length} arquivo(s) de um envio anterior sem cópia neste
          aparelho.
        </strong>
        <p>
          As respostas e os arquivos já recebidos continuam preservados. Remova
          as pendências para selecionar novamente os arquivos que faltam.
        </p>
        <button
          className="button secondary"
          disabled={working || busy}
          onClick={async () => {
            setWorking(true);
            try {
              for (const file of orphans)
                await rpc('cancel_evidence_upload', { kind, resource, file });
              setOrphans([]);
              onPending(false);
            } catch (e) {
              onError(describeError(e));
            } finally {
              setWorking(false);
            }
          }}
        >
          {working
            ? 'Atualizando…'
            : 'Remover pendências e selecionar novos arquivos'}
        </button>
      </div>
    </section>
  );
}
