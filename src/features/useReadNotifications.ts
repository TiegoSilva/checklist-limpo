import { useEffect } from 'react';
import type { Notice } from '../domain';
export function scheduleNotificationRead(environment: {
  visible: () => boolean;
  subscribe: (listener: () => void) => () => void;
  read: () => Promise<unknown>;
  delay?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let reading = false;
  const update = () => {
    clearTimeout(timer);
    if (!disposed && !reading && environment.visible())
      timer = setTimeout(() => {
        if (disposed || !environment.visible()) return;
        reading = true;
        void environment.read().catch(() => {
          reading = false;
        });
      }, environment.delay ?? 2000);
  };
  const unsubscribe = environment.subscribe(update);
  update();
  return () => {
    disposed = true;
    clearTimeout(timer);
    unsubscribe();
  };
}
export default function useReadNotifications(
  active: boolean,
  notices: Notice[],
  read: (ids: string[]) => Promise<unknown>,
) {
  const ids = notices
    .filter((n) => !n.read_at)
    .map((n) => n.id)
    .sort()
    .join(',');
  useEffect(() => {
    if (!active || !ids) return;
    return scheduleNotificationRead({
      visible: () => document.visibilityState === 'visible',
      subscribe: (listener) => {
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      },
      read: () => read(ids.split(',')),
    });
  }, [active, ids, read]);
}
