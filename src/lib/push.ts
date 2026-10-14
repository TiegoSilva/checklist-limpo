import { rpc } from './client';
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window))
    throw new Error(
      'Este navegador não suporta push. No iOS, adicione o aplicativo à tela inicial.',
    );
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!key)
    throw new Error(
      'O administrador precisa configurar a chave pública VAPID.',
    );
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error(
      'Permissão não concedida. As notificações continuam disponíveis na central.',
    );
  const registration = await navigator.serviceWorker.ready;
  const raw = atob(key.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes,
  });
  await rpc('subscribe_push', { subscription: subscription.toJSON() });
}
export async function disablePush() {
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (sub) {
    await rpc('unsubscribe_push', { endpoint_url: sub.endpoint });
    await sub.unsubscribe();
  }
}
