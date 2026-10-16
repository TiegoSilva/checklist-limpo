type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
let promptEvent: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
export function standalone() {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}
export function devicePlatform(userAgent: string, touches = 0) {
  return /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && touches > 1)
    ? 'ios'
    : /Android/.test(userAgent)
      ? 'android'
      : 'desktop';
}
export function setupInstallPrompt() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptEvent = e as InstallPrompt;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = null;
    emit();
  });
}
export const subscribeInstall = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const installState = () =>
  installed || standalone()
    ? 'installed'
    : promptEvent
      ? 'available'
      : 'manual';
export async function installApp() {
  if (!promptEvent) return 'manual';
  const event = promptEvent;
  promptEvent = null;
  emit();
  await event.prompt();
  const result = await event.userChoice;
  emit();
  return result.outcome;
}
