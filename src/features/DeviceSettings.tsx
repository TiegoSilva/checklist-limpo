import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bell, BellOff, Check, Download, Smartphone } from 'lucide-react';
import {
  devicePlatform,
  installApp,
  installState,
  subscribeInstall,
} from '../lib/install';
import {
  disablePush,
  enablePush,
  pushState,
  testPush,
  type PushState,
} from '../lib/push';
export default function DeviceSettings() {
  const install = useSyncExternalStore(
    subscribeInstall,
    installState,
    () => 'manual',
  );
  const [instructions, setInstructions] = useState(false),
    [platform, setPlatform] = useState('desktop');
  const [push, setPush] = useState<PushState | null>(null),
    [serverReady, setServerReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const refresh = async () => {
    try {
      setPush(await pushState());
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível conferir este aparelho.',
      );
    }
  };
  useEffect(() => {
    let active = true;
    setPlatform(devicePlatform(navigator.userAgent, navigator.maxTouchPoints));
    void pushState()
      .then((next) => {
        if (active) setPush(next);
      })
      .catch(() => {
        if (active)
          setError('Não foi possível conferir este aparelho. Tente novamente.');
      });
    void fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active) setServerReady(data?.pushConfigured === true);
      })
      .catch(() => {
        if (active) setServerReady(false);
      });
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  const act = async (fn: () => Promise<void>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage(success);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível concluir. Tente novamente.',
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const enabled = push?.status === 'enabled';
  const canEnable = push?.status === 'disabled' && serverReady === true;
  return (
    <div className="device-settings">
      <section className="panel device-card">
        <div className="device-card-heading">
          <span className="section-icon">
            <Smartphone size={24} />
          </span>
          <div>
            <h2>Instalar na tela inicial</h2>
            <p>Abra a operação pelo ícone do app no seu aparelho.</p>
          </div>
        </div>
        {install === 'installed' ? (
          <p className="device-status">
            <Check size={18} />
            App aberto pela tela inicial
          </p>
        ) : (
          <>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setError('');
                setBusy(true);
                try {
                  const result = await installApp();
                  if (result === 'manual') setInstructions(true);
                  else if (result === 'accepted')
                    setMessage(
                      'Instalação solicitada. Aguarde a confirmação do aparelho.',
                    );
                } catch {
                  setInstructions(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Download size={18} />
              Instalar aplicativo
            </button>
            <button
              className="text-button"
              onClick={() => setInstructions(!instructions)}
              aria-expanded={instructions}
            >
              Como instalar
            </button>
          </>
        )}
        {instructions && install !== 'installed' && (
          <div className="install-instructions">
            {platform === 'ios' ? (
              <ol>
                <li>Abra este endereço no Safari.</li>
                <li>Toque em Compartilhar e em Adicionar à Tela de Início.</li>
                <li>Confirme Adicionar e abra o app pelo novo ícone.</li>
              </ol>
            ) : platform === 'android' ? (
              <ol>
                <li>Abra este endereço no Chrome do aparelho.</li>
                <li>
                  No menu ⋮, escolha Instalar aplicativo ou Adicionar à tela
                  inicial.
                </li>
                <li>Confirme e abra o app pelo ícone.</li>
              </ol>
            ) : (
              <ol>
                <li>
                  Use a opção de instalar na barra de endereço ou no menu do
                  navegador.
                </li>
                <li>
                  Se ela não aparecer, abra o endereço no Chrome ou Edge. No
                  celular, use Chrome ou Safari.
                </li>
              </ol>
            )}
            <p>
              O navegador decide quando oferecer a instalação. Se o app já
              estiver instalado, abra pelo ícone existente.
            </p>
          </div>
        )}
      </section>
      <section className="panel device-card">
        <div className="device-card-heading">
          <span className="section-icon">
            <Bell size={24} />
          </span>
          <div>
            <h2>Notificações neste aparelho</h2>
            <p>Receba avisos de ordens e revisões mesmo com o app fechado.</p>
          </div>
        </div>
        <p
          className={`device-status ${enabled ? 'enabled' : ''}`}
          role="status"
        >
          {push?.message ?? 'Conferindo a configuração do aparelho…'}
        </p>
        {serverReady === false && push?.status !== 'unconfigured' && (
          <p className="device-hint">
            A entrega de avisos precisa ser configurada pelo administrador na
            hospedagem.
          </p>
        )}
        <div className="button-row">
          {enabled ? (
            <>
              <button
                className="button primary"
                disabled={busy || serverReady !== true}
                onClick={() =>
                  void act(
                    testPush,
                    'Teste enviado ao provedor. Confira a notificação neste aparelho; modo silencioso e Foco podem ocultar o aviso.',
                  )
                }
              >
                <Bell size={18} />
                Enviar teste
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    disablePush,
                    'Notificações desativadas neste aparelho.',
                  )
                }
              >
                <BellOff size={18} />
                Desativar avisos
              </button>
            </>
          ) : (
            <button
              className="button primary"
              disabled={busy || !canEnable}
              onClick={() =>
                void act(
                  enablePush,
                  'Notificações ativadas neste aparelho. Use Enviar teste para conferir a entrega.',
                )
              }
            >
              <Bell size={18} />
              {busy ? 'Configurando…' : 'Ativar notificações'}
            </button>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Conferir novamente
          </button>
        </div>
        <p className="device-hint">
          A permissão vale para este aparelho. As configurações de som, tela
          bloqueada e Foco são controladas pelo sistema do celular. Os avisos
          não mostram nomes de hóspedes ou detalhes da propriedade.
        </p>
      </section>
      {message && (
        <p className="alert" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
