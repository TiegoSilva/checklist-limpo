import { rpc, supabase } from './client';
import { devicePlatform, standalone } from './install';
export type PushState = {
  status:
    | 'enabled'
    | 'disabled'
    | 'denied'
    | 'unsupported'
    | 'install'
    | 'unconfigured';
  message: string;
};
export function pushCapability(): PushState | null {
  if (
    devicePlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ios' &&
    !standalone()
  )
    return {
      status: 'install',
      message:
        'No iPhone e iPad, instale o app na tela inicial e abra pelo ícone antes de ativar os avisos.',
    };
  if (
    !window.isSecureContext ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  )
    return {
      status: 'unsupported',
      message:
        'Este navegador não permite notificações neste aparelho. Use o app instalado em um navegador compatível.',
    };
  if (Notification.permission === 'denied')
    return {
      status: 'denied',
      message:
        'Os avisos estão bloqueados. Nas configurações do navegador ou do aparelho, permita as notificações deste app e volte aqui.',
    };
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY)
    return {
      status: 'unconfigured',
      message:
        'O administrador precisa configurar as chaves de notificações na hospedagem.',
    };
  return null;
}
async function worker() {
  const registration =
    (await navigator.serviceWorker.getRegistration('/')) ??
    (await navigator.serviceWorker.register('/sw.js'));
  if (registration.active) return registration;
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                'O app ainda está sendo preparado. Atualize a página e tente novamente.',
              ),
            ),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export async function pushState(): Promise<PushState> {
  const unavailable = pushCapability();
  if (unavailable) return unavailable;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const sub = await registration?.pushManager.getSubscription();
  if (sub && supabase) {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('active')
      .eq('endpoint', sub.endpoint)
      .maybeSingle();
    if (error)
      throw new Error(
        'Não foi possível conferir a configuração deste aparelho. Tente novamente.',
      );
    if (data?.active && Notification.permission === 'granted')
      return {
        status: 'enabled',
        message:
          'Este aparelho está vinculado e autorizado a receber avisos, mesmo com o app fechado.',
      };
  }
  return {
    status: 'disabled',
    message:
      'Ative para receber avisos de novas ordens, envios e revisões neste aparelho.',
  };
}
export async function enablePush() {
  const unavailable = pushCapability();
  if (unavailable) throw new Error(unavailable.message);
  // A permissão é pedida diretamente pelo toque do usuário, antes de qualquer await.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error(
      'Permissão não concedida. Os avisos continuam disponíveis na central do app.',
    );
  const registration = await worker();
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
  const raw = atob(key.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  const oldKey = subscription?.options.applicationServerKey;
  if (
    subscription &&
    oldKey &&
    (new Uint8Array(oldKey).length !== bytes.length ||
      new Uint8Array(oldKey).some((b, i) => b !== bytes[i]))
  ) {
    await rpc('unsubscribe_push', { endpoint_url: subscription.endpoint });
    if (!(await subscription.unsubscribe()))
      throw new Error(
        'Não foi possível atualizar o vínculo deste aparelho. Tente novamente.',
      );
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes,
  });
  await rpc('subscribe_push', { subscription: subscription.toJSON() });
}
export async function disablePush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const sub = await registration?.pushManager.getSubscription();
  if (sub) {
    let failure: unknown;
    try {
      await rpc('unsubscribe_push', { endpoint_url: sub.endpoint });
    } catch (error) {
      failure = error;
    }
    if (!(await sub.unsubscribe()))
      throw new Error(
        'Revogue a permissão nas configurações do navegador para encerrar os avisos.',
      );
    if (failure)
      throw new Error(
        'O vínculo local foi removido. Confira a conexão para confirmar a desativação na conta.',
      );
  }
}
export async function testPush() {
  if (!supabase) throw new Error('Entre novamente.');
  const sub = await (
    await navigator.serviceWorker.getRegistration('/')
  )?.pushManager.getSubscription();
  if (!sub) throw new Error('Ative as notificações deste aparelho primeiro.');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Entre novamente.');
  const response = await fetch('/api/notifications', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ test_endpoint: sub.endpoint }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? 'Não foi possível enviar o teste.');
}
