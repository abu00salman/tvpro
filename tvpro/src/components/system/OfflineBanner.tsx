'use client';

import { app } from '@/store/app';
import { useStore } from '@/store/createStore';
import { useI18n } from '@/lib/i18n';
import { Icon } from '../ui/Icon';

/** Small and calm. Appears when the network drops and leaves on its own; playback reconnects by itself. */
export function OfflineBanner() {
  const { t } = useI18n();
  const online = useStore(app, (s) => s.online);
  if (online) return null;
  return (
    <div role="status" aria-live="polite" className="pop-enter glass pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.25rem)] z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg px-4 py-3 shadow-pop">
      <Icon name="wifiOff" size={18} className="shrink-0 text-muted" />
      <p className="text-sm"><span className="font-medium">{t('offline.title')}</span> <span className="text-muted">{t('offline.body')}</span></p>
    </div>
  );
}
