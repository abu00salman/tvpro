import { playback, playerStore } from '@/lib/player/controller';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/en';
import { app } from '@/store/app';
import { useStore } from '@/store/createStore';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/controls';

/** Loading / reconnecting / error states. Human sentences only; codes stay in developer mode. */
export function PlayerStatusOverlay({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const status = useStore(playerStore, (s) => s.status);
  const error = useStore(playerStore, (s) => s.error);
  const detail = useStore(playerStore, (s) => s.errorDetail);
  const engine = useStore(playerStore, (s) => s.engine);
  const developer = useStore(app, (s) => s.settings.developerMode);

  if (status === 'error' && error) {
    return (
      <div role="alert" className="absolute inset-0 z-10 grid place-items-center bg-black/80 p-6 text-center text-white">
        <div className="max-w-sm">
          <Icon name={error === 'offline' ? 'wifiOff' : 'live'} size={28} className="mx-auto mb-4 text-white/50" />
          <p className="text-base font-medium">{t(`player.err.${error}` as MessageKey)}</p>
          {error === 'offline' && <p className="mt-1 text-sm text-white/60">{t('offline.body')}</p>}
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" data-autofocus onClick={() => playback.retry()} className="btn h-10 bg-white px-5 text-black hover:bg-white/90">
              <Icon name="refresh" size={16} /> {t('player.retry')}
            </button>
            {onBack && (
              <button type="button" onClick={onBack} className="btn h-10 border border-white/20 px-5 text-white hover:bg-white/10">{t('player.back')}</button>
            )}
          </div>
          {developer && detail && <p dir="ltr" className="mt-4 break-all font-mono text-[0.7rem] text-white/40">{engine} · {detail}</p>}
        </div>
      </div>
    );
  }
  if (status === 'loading' || status === 'reconnecting' || status === 'buffering') {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-white">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={30} />
          {status !== 'buffering' && <p className="text-xs text-white/70">{t(status === 'loading' ? 'player.connecting' : 'player.reconnecting')}</p>}
        </div>
      </div>
    );
  }
  return null;
}
