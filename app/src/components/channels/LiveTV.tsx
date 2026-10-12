'use client';

import { playerStore } from '@/lib/player/controller';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel } from '@/types';
import { app, playChannel, previousChannel, zap } from '@/store/app';
import { epgKey, epgStore, nowAndNext } from '@/store/epg';
import { useStore } from '@/store/createStore';
import { useNow } from '@/hooks/useNow';
import { useVirtualGrid } from '@/hooks/useVirtualGrid';
import { groupCounts } from '@/hooks/useLibrary';
import { useI18n } from '@/lib/i18n';
import { preloadHls } from '@/lib/player/engines';
import { announceNowPlaying } from '@/lib/player/mediaSession';
import { normalize } from '@/lib/search';
import { cx, formatHour, itemKey } from '@/lib/utils';
import { Player } from '../player/Player';
import { Icon } from '../ui/Icon';
import { EmptyState, ProgressBar } from '../ui/controls';
import { CHANNEL_ROW_HEIGHT, ChannelRow } from './ChannelRow';

const ALL = '\u0000all';
const FAVORITES = '\u0000fav';

export function LiveTV({ initialCategory }: { initialCategory?: string }) {
  const { t, locale } = useI18n();
  const channels = useStore(app, (s) => s.channels);
  const favorites = useStore(app, (s) => s.favorites);
  const currentId = useStore(app, (s) => s.currentChannelId);
  const hasPrevious = useStore(app, (s) => Boolean(s.previousChannelId));
  const zapCount = useStore(app, (s) => s.zapCount);
  const epg = useStore(epgStore, (s) => s.index);
  const now = useNow();

  const [category, setCategory] = useState(initialCategory ?? ALL);
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => groupCounts(channels).sort((a, b) => a.name.localeCompare(b.name)), [channels]);
  const visible = useMemo(() => {
    let list = channels;
    if (category === FAVORITES) list = list.filter((c) => favorites[itemKey('channel', c.id)]);
    else if (category !== ALL) list = list.filter((c) => c.group === category);
    const q = normalize(filter);
    return q ? list.filter((c) => normalize(c.name).includes(q)) : list;
  }, [channels, favorites, category, filter]);

  const current = useMemo(() => channels.find((c) => c.id === currentId), [channels, currentId]);
  const guide = current ? nowAndNext(epg[epgKey(current)], now) : {};

  const list = useVirtualGrid({ count: visible.length, rowHeight: CHANNEL_ROW_HEIGHT, overscan: 6 });
  const visibleRef = useRef<Channel[]>(visible);
  visibleRef.current = visible;

  const select = useCallback((id: string) => void playChannel(id), []);
  const onZap = useCallback((delta: number) => zap(delta, visibleRef.current), []);

  // Warm the player code the moment Live TV opens; resume the last channel if the viewer wants that.
  useEffect(() => {
    preloadHls();
    const { settings, currentChannelId, channels: all } = app.get();
    // Coming back from another screen the player is idle again, so resume whatever was on.
    const resume = currentChannelId ?? settings.lastChannelId;
    if (playerStore.get().status === 'idle' && settings.autoPlay && resume && all.some((c) => c.id === resume)) void playChannel(resume);
  }, []);

  useEffect(() => {
    const index = visibleRef.current.findIndex((c) => c.id === currentId);
    list.scrollToIndex(index);
    // When the remote is "on" the channel list, focus travels with the channel so ↑ ↓ keep zapping.
    const focused = document.activeElement as HTMLElement | null;
    if (!focused?.matches('[role="option"]')) return;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus({ preventScroll: true }));
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, category]);

  useEffect(() => {
    if (current) announceNowPlaying({ title: current.name, subtitle: guide.current?.title, artwork: current.logo, onPrevious: () => onZap(-1), onNext: () => onZap(1) });
  }, [current, guide.current?.title, onZap]);

  if (!channels.length) return <EmptyState icon="live" title={t('empty.channels')} />;

  const categories = [
    { id: ALL, label: t('live.all'), count: channels.length },
    { id: FAVORITES, label: t('nav.favorites'), count: channels.filter((c) => favorites[itemKey('channel', c.id)]).length },
    ...groups.map((g) => ({ id: g.name, label: g.name || t('live.uncategorized'), count: g.count })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-5 xl:grid-cols-[13rem_23rem_minmax(0,1fr)] landscape:max-lg:flex-row">
      {/* Player first in the DOM: it is what matters, and it sticks to the top on phones */}
      <section className="z-10 shrink-0 lg:order-3 lg:overflow-y-auto landscape:max-lg:w-[58%]" aria-label={current?.name ?? t('nav.live')}>
        <Player
          className="aspect-video w-full lg:rounded-lg"
          title={current?.name ?? ''} subtitle={guide.current?.title} logo={current?.logo} number={current?.number}
          bannerKey={zapCount} favorite={current ? { kind: 'channel', id: current.id } : undefined}
          onZap={onZap} onPrevious={hasPrevious ? previousChannel : undefined}
          placeholder={
            <div className="grid h-full place-items-center bg-surface text-center text-fg">
              <div className="px-6">
                <Icon name="live" size={28} className="mx-auto mb-3 text-faint" />
                <p className="font-medium">{t('live.select')}</p>
                <p className="mt-1 hidden text-sm text-muted sm:block">{t('live.selectBody')}</p>
              </div>
            </div>
          }
        />
        {current && (
          <div className="hidden gap-4 px-1 pt-5 lg:grid lg:grid-cols-2">
            {([['live.now', guide.current], ['live.next', guide.next]] as const).map(([label, program]) => (
              <div key={label} className="min-w-0">
                <p className="eyebrow">{t(label)}</p>
                {program ? (
                  <>
                    <p className="mt-1.5 truncate font-medium">{program.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted tabular" dir="ltr">{formatHour(program.start, locale)} – {formatHour(program.end, locale)}</p>
                    {label === 'live.now' && <ProgressBar value={(now - program.start) / (program.end - program.start)} className="mt-3" />}
                    {label === 'live.now' && program.description && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">{program.description}</p>}
                  </>
                ) : (
                  <p className="mt-1.5 text-sm text-faint">{t('live.noProgram')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Categories: rail on wide screens, chips elsewhere */}
      <nav aria-label={t('live.categories')} className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-4 py-3 lg:hidden xl:order-1 xl:flex xl:flex-col xl:gap-0.5 xl:overflow-y-auto xl:p-0 landscape:max-lg:hidden">
        <p className="eyebrow hidden px-3 pb-2 xl:block">{t('live.categories')}</p>
        {categories.map((c) => (
          <button
            key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}
            className={cx(
              'flex h-9 shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors duration-150 xl:h-10 xl:rounded-md xl:border-0 xl:px-3',
              category === c.id ? 'border-accent/40 bg-accent/10 font-medium text-accent' : 'border-line text-muted hover:bg-raised hover:text-fg',
            )}
          >
            <span className="truncate">{c.label}</span>
            <span className="hidden font-mono text-[0.7rem] text-faint tabular xl:inline">{c.count}</span>
          </button>
        ))}
      </nav>

      {/* Channels */}
      <section className="flex min-h-0 flex-1 flex-col lg:order-2" aria-label={t('search.channels')}>
        <div className="hidden items-center gap-2 pb-2 lg:flex">
          <label className="relative flex-1">
            <Icon name="search" size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('live.filter')} aria-label={t('live.filter')} className="field h-10 ps-9 text-sm" />
          </label>
          <select
            value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('live.categories')}
            className="field h-10 w-40 text-sm xl:hidden"
          >
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div ref={list.ref} role="listbox" aria-label={t('search.channels')} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-24 lg:px-0 lg:pb-4">
          <div style={{ height: list.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${list.offsetTop}px)` }}>
              {visible.slice(list.start, list.end).map((c) => (
                <ChannelRow key={c.id} channel={c} active={c.id === currentId} now={now} program={nowAndNext(epg[epgKey(c)], now).current} onSelect={select} />
              ))}
            </div>
          </div>
          {!visible.length && <p className="px-3 py-10 text-center text-sm text-muted">{t('search.none')}</p>}
        </div>
      </section>
    </div>
  );
}

