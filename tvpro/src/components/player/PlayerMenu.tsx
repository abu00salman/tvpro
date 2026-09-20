import { useEffect, useRef } from 'react';
import { playback, playerStore } from '@/lib/player/controller';
import type { TrackOption } from '@/lib/player/types';
import { useI18n } from '@/lib/i18n';
import { useStore } from '@/store/createStore';
import { cx } from '@/lib/utils';
import { Icon } from '../ui/Icon';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface SectionProps {
  title: string;
  options: TrackOption[];
  value: number;
  onSelect: (id: number) => void;
}

function Section({ title, options, value, onSelect }: SectionProps) {
  return (
    <div role="group" aria-label={title} className="py-1.5">
      <p className="px-3 pb-1 pt-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-white/45">{title}</p>
      {options.map((o) => (
        <button
          key={o.id} type="button" role="menuitemradio" aria-checked={o.id === value} onClick={() => onSelect(o.id)}
          className={cx('flex h-9 w-full items-center justify-between gap-6 rounded-[8px] px-3 text-sm transition-colors hover:bg-white/10',
            o.id === value ? 'text-white' : 'text-white/70')}
        >
          <span className="truncate">{o.label}</span>
          {o.id === value && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}

interface Props {
  live: boolean;
  speed: number;
  onSpeed: (rate: number) => void;
  onClose: () => void;
}

/** Only lists what the current source really offers — no dead options. */
export function PlayerMenu({ live, speed, onSpeed, onClose }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const qualities = useStore(playerStore, (s) => s.qualities);
  const quality = useStore(playerStore, (s) => s.quality);
  const audioTracks = useStore(playerStore, (s) => s.audioTracks);
  const audioTrack = useStore(playerStore, (s) => s.audioTrack);
  const textTracks = useStore(playerStore, (s) => s.textTracks);
  const textTrack = useStore(playerStore, (s) => s.textTrack);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest('[data-menu-toggle]')) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const auto = { id: -1, label: t('player.auto') };
  const off = { id: -1, label: t('player.off') };

  return (
    <div
      ref={ref} role="menu" data-focus-scope aria-label={t('player.options')}
      className="pop-enter absolute bottom-full end-2 z-20 mb-2 max-h-[min(60vh,22rem)] w-56 divide-y divide-white/10 overflow-y-auto rounded-lg border border-white/10 bg-black/80 p-1.5 text-white shadow-pop backdrop-blur-xl"
    >
      <Section title={t('player.quality')} options={[auto, ...qualities]} value={quality} onSelect={(id) => playback.setQuality(id)} />
      {audioTracks.length > 0 && (
        <Section title={t('player.audio')} options={audioTracks} value={audioTrack} onSelect={(id) => playback.setAudioTrack(id)} />
      )}
      {textTracks.length > 0 && (
        <Section title={t('player.subtitles')} options={[off, ...textTracks]} value={textTrack} onSelect={(id) => playback.setTextTrack(id)} />
      )}
      {!live && (
        <Section title={t('player.speed')} options={SPEEDS.map((s, i) => ({ id: i, label: s === 1 ? '1× ' : `${s}×` }))} value={SPEEDS.indexOf(speed)} onSelect={(i) => onSpeed(SPEEDS[i])} />
      )}
    </div>
  );
}
